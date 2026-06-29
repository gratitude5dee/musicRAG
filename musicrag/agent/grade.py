from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

from musicrag.agent.intent import QueryPlan


@dataclass(frozen=True)
class Grade:
    sufficient: bool
    confidence: float
    reason: str


def _score_of(doc: dict[str, Any]) -> float:
    for key in ("agg_score", "rerank_score", "combined_score", "rrf_score", "score"):
        value = doc.get(key)
        if value is not None:
            return float(value)
    return 0.0


def _guest_aligned(doc: dict[str, Any], names: set[str]) -> bool:
    guests = {g.lower() for g in (doc.get("guests") or [])}
    title = (doc.get("title") or "").lower()
    return bool(names & guests) or any(name in title for name in names)


def grade_retrieval(
    plan: QueryPlan,
    docs: list[dict[str, Any]],
    *,
    min_docs: int = 3,
    top_score_floor: float = 0.30,
    llm: Optional[Callable[[str, list[dict[str, Any]]], bool]] = None,
) -> Grade:
    """Decide whether retrieved docs can answer the query (CRAG-style grade).

    Deterministic and offline-testable. Signals:

    * **enough** - at least ``min_docs`` candidates.
    * **entity alignment** - if the plan names guests, at least one of the top-5
      docs must belong to / mention that guest. Failing this is the signal that an
      ``ENTITY_LOOKUP`` missed and should be broadened (the 0.0-recall case).
    * **concentration** - share of the top-5 that come from the leading episode
      (a clear known-item winner scores high).
    * **score floor** - only lowers confidence; never the sole reason to fail, so
      synthetic-score tests stay stable.

    ``llm`` is an optional grader hook; when provided its boolean verdict
    overrides ``sufficient`` (confidence is still reported from the heuristics).
    """
    if not docs:
        return Grade(False, 0.0, "no documents retrieved")

    n = len(docs)
    enough = n >= min_docs

    names = {g.lower() for g in plan.guests}
    aligned = sum(1 for doc in docs[:5] if _guest_aligned(doc, names)) if names else 0
    alignment_ok = (not names) or aligned >= 1

    top = docs[0]
    top_vid = top.get("video_id")
    top_n = min(5, n)
    concentration = sum(1 for doc in docs[:top_n] if doc.get("video_id") == top_vid) / top_n

    top_score = _score_of(top)
    score_ok = (top_score >= top_score_floor) if top_score else True

    confidence = (
        0.35 * (1.0 if alignment_ok else 0.0)
        + 0.25 * concentration
        + 0.25 * (1.0 if enough else 0.0)
        + 0.15 * (1.0 if score_ok else 0.0)
    )

    sufficient = bool(enough and alignment_ok)

    reasons: list[str] = []
    if not enough:
        reasons.append(f"only {n} docs (<{min_docs})")
    if names and not alignment_ok:
        reasons.append("no top-5 doc matches the named guest")
    if not score_ok:
        reasons.append(f"top score {top_score:.2f} below floor {top_score_floor:.2f}")
    reason = "; ".join(reasons) if reasons else "passed heuristics"

    if llm is not None:
        try:
            verdict = bool(llm(plan.query, docs))
            return Grade(verdict, confidence, reason + " | llm verdict applied")
        except Exception:
            pass

    return Grade(sufficient, round(confidence, 3), reason)
