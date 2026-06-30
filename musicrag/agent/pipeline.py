from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any, Callable, Optional

from musicrag.agent.grade import Grade, grade_retrieval
from musicrag.agent.intent import Intent, QueryPlan, Vocabulary, classify_intent
from musicrag.agent.tools import episode_chunks, find_episodes_by_guest

# Type aliases for the injected online components.
RetrieveFn = Callable[[str, Optional[dict[str, Any]], int], list[dict[str, Any]]]
RerankFn = Callable[[str, list[dict[str, Any]], int], list[dict[str, Any]]]
GenerateFn = Callable[[str, list[dict[str, Any]]], dict[str, Any]]


@dataclass
class AgentTools:
    """Everything the orchestrator needs, injected so the control flow is testable.

    Production wiring lives in ``default_tools``; tests pass fakes.
    """

    vocab: Vocabulary
    retrieve: RetrieveFn  # hybrid vector+text+RRF (musicrag.query.retrieve.retrieve)
    rerank: RerankFn  # episode-aware rerank (musicrag.query.rerank.rerank)
    db: Any = None
    generate: Optional[GenerateFn] = None
    llm_router: Optional[Callable[[str], dict[str, Any]]] = None
    max_rewrites: int = 1
    top_k: int = 8
    candidate_limit: int = 80


@dataclass
class AgentState:
    query: str
    # Explicit facets from the caller (e.g. UI filters). Inferred facets from the
    # classifier are used only for routing/graph-resolution, never as hard filters
    # - hard-filtering on a guessed topic/channel was measured to tank recall.
    filters: Optional[dict[str, Any]] = None
    plan: Optional[QueryPlan] = None
    docs: list[dict[str, Any]] = field(default_factory=list)
    grade: Optional[Grade] = None
    rewrites: int = 0
    trace: list[str] = field(default_factory=list)
    answer: Optional[dict[str, Any]] = None


def _dedupe(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[Any] = set()
    out: list[dict[str, Any]] = []
    for doc in docs:
        key = doc.get("chunk_uid") or (doc.get("video_id"), doc.get("chunk_index"))
        if key in seen:
            continue
        seen.add(key)
        out.append(doc)
    return out


def best_per_video(docs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the highest-ranked chunk per episode, preserving order (diversity)."""
    seen: set[Any] = set()
    out: list[dict[str, Any]] = []
    for doc in docs:
        vid = doc.get("video_id")
        if vid in seen:
            continue
        seen.add(vid)
        out.append(doc)
    return out


def diversify_by_video(
    docs: list[dict[str, Any]],
    *,
    limit: int,
    max_per_video: int = 2,
    min_videos: int | None = None,
) -> list[dict[str, Any]]:
    """Prefer corpus-wide evidence before adjacent chunks from the same episode."""
    min_videos = min(limit, min_videos or max(1, (limit + 1) // 2))
    selected: list[dict[str, Any]] = []
    seen_chunks: set[Any] = set()
    video_counts: dict[Any, int] = {}

    def chunk_key(doc: dict[str, Any]) -> Any:
        return doc.get("chunk_uid") or (doc.get("video_id"), doc.get("chunk_index"))

    def add(doc: dict[str, Any], cap: float) -> bool:
        if len(selected) >= limit:
            return False
        key = chunk_key(doc)
        if key in seen_chunks:
            return False
        video_id = doc.get("video_id") or key
        if video_counts.get(video_id, 0) >= cap:
            return False
        selected.append(doc)
        seen_chunks.add(key)
        video_counts[video_id] = video_counts.get(video_id, 0) + 1
        return True

    for doc in docs:
        if len(video_counts) >= min_videos or len(selected) >= limit:
            break
        add(doc, 1)
    for doc in docs:
        if len(selected) >= limit:
            break
        add(doc, max_per_video)
    for doc in docs:
        if len(selected) >= limit:
            break
        add(doc, float("inf"))
    return selected


# --- nodes -----------------------------------------------------------------------


def node_classify(state: AgentState, tools: AgentTools) -> None:
    state.plan = classify_intent(state.query, tools.vocab, tools.llm_router)
    state.trace.append(f"classify -> {state.plan.intent.value} ({state.plan.rationale})")


def _route_entity(state: AgentState, tools: AgentTools) -> None:
    plan = state.plan
    assert plan is not None
    candidates: list[dict[str, Any]] = []
    resolved_videos: list[str] = []

    for guest in plan.guests[:2]:
        episodes = find_episodes_by_guest(guest, db=tools.db, limit=5)
        if plan.channels:
            scoped = [e for e in episodes if e.get("channel") in plan.channels]
            episodes = scoped or episodes
        for episode in episodes:
            vid = episode.get("video_id")
            if vid and vid not in resolved_videos:
                resolved_videos.append(vid)

    # Graph-guaranteed candidates: pull chunks for the resolved episodes even if a
    # blind chunk search would never surface them (the 0.0 known-item fix).
    for vid in resolved_videos[:5]:
        candidates.extend(
            {**chunk, "graph_resolved": True}
            for chunk in episode_chunks(vid, db=tools.db, limit=8)
        )

    # Union with UNFILTERED hybrid recall (explicit facets only) so the candidate
    # set never drops below the baseline retriever - the graph chunks are additive.
    candidates.extend(tools.retrieve(plan.query, state.filters, tools.candidate_limit))

    deduped = _dedupe(candidates)
    base_docs = tools.rerank(plan.query, deduped, tools.top_k)
    if resolved_videos and not grade_retrieval(plan, base_docs).sufficient:
        ranked = tools.rerank(plan.query, deduped, max(tools.candidate_limit, tools.top_k * 3))
        resolved = [doc for doc in ranked if doc.get("video_id") in set(resolved_videos)]
        state.docs = diversify_by_video(
            resolved + ranked,
            limit=tools.top_k,
            max_per_video=tools.top_k,
            min_videos=min(tools.top_k, len(resolved_videos)),
        )
    else:
        state.docs = base_docs
    state.trace.append(
        f"route=entity guests={plan.guests} resolved_episodes={len(resolved_videos)} "
        f"candidates={len(deduped)}"
    )


def _route_thematic(state: AgentState, tools: AgentTools) -> None:
    plan = state.plan
    assert plan is not None
    docs = tools.retrieve(plan.query, state.filters, tools.candidate_limit)
    ranked = tools.rerank(plan.query, docs, max(tools.candidate_limit, tools.top_k * 3, 24))
    state.docs = diversify_by_video(
        ranked,
        limit=tools.top_k,
        max_per_video=1,
        min_videos=tools.top_k,
    )
    state.trace.append(
        f"route=thematic filters={state.filters} candidates={len(docs)} "
        f"diversified={len({doc.get('video_id') for doc in state.docs})}"
    )


def _route_comparative(state: AgentState, tools: AgentTools) -> None:
    plan = state.plan
    assert plan is not None
    merged: list[dict[str, Any]] = []
    per_entity = max(2, tools.top_k // max(1, len(plan.subqueries) or 1))
    for sub in plan.subqueries or [plan.query]:
        docs = tools.retrieve(sub, state.filters, max(20, tools.candidate_limit // 2))
        merged.extend(tools.rerank(sub, docs, per_entity))
    state.docs = _dedupe(merged)[: tools.top_k]
    state.trace.append(f"route=comparative subqueries={len(plan.subqueries)} merged={len(merged)}")


def _route_aggregative(state: AgentState, tools: AgentTools) -> None:
    plan = state.plan
    assert plan is not None
    docs = tools.retrieve(plan.query, state.filters, max(tools.candidate_limit, 60))
    ranked = tools.rerank(plan.query, docs, max(tools.top_k * 3, 24))
    state.docs = best_per_video(ranked)[: tools.top_k]
    state.trace.append(f"route=aggregative candidates={len(docs)} diversified={len(state.docs)}")


_ROUTES = {
    Intent.ENTITY_LOOKUP: _route_entity,
    Intent.THEMATIC: _route_thematic,
    Intent.COMPARATIVE: _route_comparative,
    Intent.AGGREGATIVE: _route_aggregative,
}


def node_route(state: AgentState, tools: AgentTools) -> None:
    assert state.plan is not None
    _ROUTES[state.plan.intent](state, tools)


def node_grade(state: AgentState, tools: AgentTools) -> None:
    assert state.plan is not None
    state.grade = grade_retrieval(state.plan, state.docs)
    state.trace.append(
        f"grade sufficient={state.grade.sufficient} "
        f"confidence={state.grade.confidence} ({state.grade.reason})"
    )


def node_rewrite(state: AgentState, tools: AgentTools) -> None:
    """Broaden the plan when retrieval graded insufficient, then re-route."""
    plan = state.plan
    assert plan is not None
    state.rewrites += 1
    if plan.intent in (Intent.ENTITY_LOOKUP, Intent.COMPARATIVE):
        # A named-entity route missed: drop to a thematic search without the
        # guest pin (keep topic/channel as soft context) to widen recall.
        state.plan = replace(
            plan,
            intent=Intent.THEMATIC,
            guests=[],
            subqueries=[],
            rationale="rewrite: broaden entity/comparative -> thematic",
        )
    else:
        # Thematic missed: relax over-narrow filters entirely.
        state.plan = replace(
            plan,
            intent=Intent.THEMATIC,
            topics=[],
            channels=[],
            rationale="rewrite: drop filters to widen recall",
        )
    state.trace.append(f"rewrite#{state.rewrites}: {state.plan.rationale}")


def node_assemble(state: AgentState, tools: AgentTools) -> None:
    if tools.generate and state.docs:
        state.answer = tools.generate(state.query, state.docs)
        state.trace.append("assemble: generated grounded answer")


def run_agent(
    query: str, tools: AgentTools, filters: Optional[dict[str, Any]] = None
) -> AgentState:
    """Execute classify -> (route -> grade -> rewrite)* -> assemble.

    ``filters`` are *explicit* facets (e.g. from UI controls) and are the only
    thing applied as hard ``$vectorSearch`` filters; classifier-inferred facets
    stay soft (routing + graph resolution only).
    """
    state = AgentState(query=query, filters=filters)
    node_classify(state, tools)
    while True:
        node_route(state, tools)
        node_grade(state, tools)
        assert state.grade is not None
        if state.grade.sufficient or state.rewrites >= tools.max_rewrites:
            break
        node_rewrite(state, tools)
    node_assemble(state, tools)
    return state


def default_tools(generate: bool = False, max_rewrites: int = 1, top_k: int = 8) -> AgentTools:
    """Wire the real components (Voyage + Mongo + AI gateway)."""
    from musicrag.agent.tools import load_vocabulary
    from musicrag.config import get_db
    from musicrag.query.rerank import rerank as _rerank
    from musicrag.query.retrieve import retrieve as _retrieve

    db = get_db()
    generate_fn: Optional[GenerateFn] = None
    if generate:
        from musicrag.query.answer import generate_answer

        def generate_fn(query: str, docs: list[dict[str, Any]]) -> dict[str, Any]:  # type: ignore[misc]
            return generate_answer(query, docs)

    return AgentTools(
        vocab=load_vocabulary(db),
        retrieve=lambda q, f, k: _retrieve(q, filters=f, limit=k),
        rerank=lambda q, docs, k: _rerank(q, docs, top_k=k),
        db=db,
        generate=generate_fn,
        max_rewrites=max_rewrites,
        top_k=top_k,
    )
