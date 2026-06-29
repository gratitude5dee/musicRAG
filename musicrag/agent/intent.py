from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional


class Intent(str, Enum):
    """How a query should be routed.

    * ``ENTITY_LOOKUP``  - known-item: a specific guest/episode is named
      ("What does Bernard MacMahon discuss with Rick Rubin?"). The right answer
      lives in one episode; resolve it through the context graph, not a blind
      chunk search. This is the class the current pipeline fails on.
    * ``THEMATIC``       - conceptual ("How do A&R find new artists?"). Hybrid
      vector+text retrieval + episode-aware rerank.
    * ``COMPARATIVE``    - multi-hop ("How do Rubin and Iovine differ on X?").
      Decompose into per-entity sub-queries, retrieve each, then synthesize.
    * ``AGGREGATIVE``    - cross-corpus ("Common threads on creativity?").
      Retrieve broadly across episodes and map-reduce.
    """

    ENTITY_LOOKUP = "entity_lookup"
    THEMATIC = "thematic"
    COMPARATIVE = "comparative"
    AGGREGATIVE = "aggregative"


@dataclass(frozen=True)
class Vocabulary:
    """Canonical names known to the corpus, keyed by lowercase surface form.

    Populated from the ``entities`` and ``channels`` collections (see
    ``musicrag.agent.tools.load_vocabulary``) or constructed directly in tests.
    """

    guests: dict[str, str] = field(default_factory=dict)
    channels: dict[str, str] = field(default_factory=dict)
    topics: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class QueryPlan:
    intent: Intent
    query: str
    guests: list[str] = field(default_factory=list)
    channels: list[str] = field(default_factory=list)
    topics: list[str] = field(default_factory=list)
    date_from_ts: Optional[int] = None
    date_to_ts: Optional[int] = None
    subqueries: list[str] = field(default_factory=list)
    rationale: str = ""

    def to_filters(self) -> dict[str, Any]:
        """Collapse the plan into the filter dict understood by the retriever."""
        filters: dict[str, Any] = {}
        if self.channels:
            filters["channel"] = self.channels[0]
        if self.guests:
            filters["guest"] = self.guests[0]
        if self.topics:
            filters["topic"] = self.topics[0]
        if self.date_from_ts is not None:
            filters["date_from_ts"] = self.date_from_ts
        if self.date_to_ts is not None:
            filters["date_to_ts"] = self.date_to_ts
        return filters


_COMPARE_PATTERNS = (
    r"\bvs\.?\b",
    r"\bversus\b",
    r"\bcompare(d)?\b",
    r"\bdifference between\b",
    r"\bdiffer\b",
    r"\bcontrast\b",
)
_AGG_PATTERNS = (
    r"\bcommon (themes?|threads?|advice|lessons?|patterns?)\b",
    r"\bacross (the )?(episodes?|guests?|channels?|interviews?)\b",
    r"\bmost (guests?|people|producers?|managers?|artists?)\b",
    r"\bconsensus\b",
    r"\bevery(one|body)\b",
    r"\bgenerally\b",
    r"\bin general\b",
    r"\brecurring\b",
)
_KNOWN_ITEM_PATTERNS = (
    r"\bwhat (does|did)\b",
    r"\bhow (does|did)\b",
    r"\baccording to\b",
    r"\bdiscuss(es|ed)?\b",
    r"\bsays?\b",
    r"\btalk(s|ed)? about\b",
)


# Normalize "smart" punctuation so a query's straight apostrophe matches a graph
# name stored with a curly one (e.g. "Adam D'Angelo" vs "Adam D’Angelo") - a real
# miss observed live where the guest was otherwise correctly in the graph.
_PUNCT_MAP = str.maketrans({"’": "'", "‘": "'", "`": "'", "´": "'", "“": '"', "”": '"'})


def _canon(text: str) -> str:
    return re.sub(r"\s+", " ", text.translate(_PUNCT_MAP).lower()).strip()


def _match_vocab(text: str, vocab: dict[str, str]) -> list[str]:
    """Return canonical names whose surface form appears as a whole token run.

    Matching is punctuation/whitespace/case insensitive (see ``_canon``).
    """
    canon_text = _canon(text)
    found: list[tuple[int, str]] = []
    seen: set[str] = set()
    # Longest surface forms first so "rick rubin" wins over a stray "rick".
    for surface in sorted(vocab, key=len, reverse=True):
        canon_surface = _canon(surface)
        if len(canon_surface) < 3:
            continue
        pattern = r"(?<!\w)" + re.escape(canon_surface) + r"(?!\w)"
        if re.search(pattern, canon_text):
            canonical = vocab[surface]
            if canonical not in seen:
                seen.add(canonical)
                found.append((len(canon_surface), canonical))
    found.sort(key=lambda item: item[0], reverse=True)
    return [name for _, name in found]


def _build_comparative_subqueries(query: str, entities: list[str]) -> list[str]:
    return [f"{entity}: {query}" for entity in entities]


def classify_intent(
    query: str,
    vocab: Optional[Vocabulary] = None,
    llm: Optional[Callable[[str], dict[str, Any]]] = None,
) -> QueryPlan:
    """Classify and plan a query. Rule-first, deterministic, offline-testable.

    ``llm`` is an optional escape hatch: a callable taking the raw query and
    returning a partial plan dict (``intent``/``guests``/``topics``/...). It is
    only consulted when the rules find no entities and no thematic signal, so the
    common cases never pay for an LLM call. Pass ``None`` (default) for pure rules.
    """
    vocab = vocab or Vocabulary()
    text = f" {query.lower()} "

    guests = _match_vocab(text, vocab.guests)
    channels = _match_vocab(text, vocab.channels)
    topics = _match_vocab(text, vocab.topics)

    is_compare = any(re.search(p, text) for p in _COMPARE_PATTERNS)
    is_agg = any(re.search(p, text) for p in _AGG_PATTERNS)
    is_known_item = any(re.search(p, text) for p in _KNOWN_ITEM_PATTERNS)

    named = guests + channels
    subqueries: list[str] = []

    if is_compare and len(named) >= 2:
        intent = Intent.COMPARATIVE
        subqueries = _build_comparative_subqueries(query, named[:3])
        rationale = f"comparison cue + {len(named)} named entities"
    elif is_agg and not guests:
        intent = Intent.AGGREGATIVE
        rationale = "aggregation cue without a single named guest"
    elif guests:
        intent = Intent.ENTITY_LOOKUP
        rationale = f"named guest(s): {', '.join(guests)}"
    elif llm is not None and not channels and not topics and not is_agg:
        plan = _plan_from_llm(query, llm)
        if plan is not None:
            return plan
        intent = Intent.THEMATIC
        rationale = "llm fallback returned nothing; defaulting to thematic"
    else:
        intent = Intent.THEMATIC
        rationale = "no named guest; conceptual/topic query"

    return QueryPlan(
        intent=intent,
        query=query,
        guests=guests,
        channels=channels,
        topics=topics,
        subqueries=subqueries,
        rationale=rationale,
    )


def _plan_from_llm(query: str, llm: Callable[[str], dict[str, Any]]) -> Optional[QueryPlan]:
    try:
        raw = llm(query) or {}
    except Exception:
        return None
    intent_value = raw.get("intent")
    try:
        intent = Intent(intent_value) if intent_value else Intent.THEMATIC
    except ValueError:
        intent = Intent.THEMATIC
    return QueryPlan(
        intent=intent,
        query=query,
        guests=list(raw.get("guests") or []),
        channels=list(raw.get("channels") or []),
        topics=list(raw.get("topics") or []),
        subqueries=list(raw.get("subqueries") or []),
        rationale="llm",
    )
