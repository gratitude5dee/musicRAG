from __future__ import annotations

from collections import defaultdict
from typing import Any

from musicrag.config import Settings, settings

# Tunables for the post-rerank fusion. Exposed as module constants so the v2 eval
# harness can sweep them without touching the Voyage call. The defaults are
# principled starting points; confirm/tune them against eval/report_v2.* on the
# live corpus.
RERANK_WEIGHT = 0.7  # weight on the (normalized) cross-encoder relevance score
RRF_WEIGHT = 0.3  # weight on the (normalized) upstream hybrid RRF score
EPISODE_DAMP = 0.5  # how much corroborating chunks from the same episode add


def format_for_rerank(doc: dict[str, Any]) -> str:
    """Build the string handed to rerank-2.5.

    The previous implementation reranked on ``doc["text"]`` alone, leaving the
    cross-encoder blind to *which episode / who is speaking*. rerank-2.5 is
    instruction-following, so a compact metadata header sharpens relevance and
    stops topically-similar chunks from unrelated episodes out-scoring the right
    one. Keep the header short so it never dominates the passage budget.
    """
    title = doc.get("title") or "Untitled"
    guests = ", ".join(doc.get("guests") or [])
    channel = doc.get("channel") or ""
    header = f"[{title}"
    if guests:
        header += f" — {guests}"
    header += f" · {channel}]" if channel else "]"
    return f"{header}\n{doc.get('text', '')}"


def _normalize(values: list[float]) -> list[float]:
    """Min-max normalize to [0, 1] so rerank and RRF scores are comparable."""
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return [1.0 for _ in values]
    return [(value - lo) / (hi - lo) for value in values]


def fuse_and_aggregate(
    docs: list[dict[str, Any]],
    *,
    rerank_weight: float = RERANK_WEIGHT,
    rrf_weight: float = RRF_WEIGHT,
    episode_damp: float = EPISODE_DAMP,
    fuse: bool = True,
    episode_aware: bool = True,
) -> list[dict[str, Any]]:
    """Re-score reranked candidates. Pure function (no network) -> unit-testable.

    Each input doc carries ``rerank_score`` (cross-encoder) and usually
    ``rrf_score`` (upstream hybrid fusion). Two corrections to the naive
    "sort by rerank_score" behavior that was *regressing* MRR/nDCG in
    eval/report.md:

    1. **Score fusion** - blend normalized cross-encoder + normalized hybrid
       score (``combined_score``) instead of letting the reranker override the
       upstream signal entirely.
    2. **Episode-aware (two-level) ranking** - for known-item questions the right
       episode usually contributes several strong chunks. Compute a per-episode
       ``video_score = max(combined) + damp * (sum(combined) - max(combined))``
       and order chunks by ``(video_score, combined_score)``. A single off-target
       chunk with a high cross-encoder score no longer beats the episode that is
       corroborated by multiple good chunks - which is what pushes the correct
       answer back to rank 1.
    """
    if not docs:
        return []

    rr = _normalize([float(doc.get("rerank_score") or 0.0) for doc in docs])
    rf = _normalize([float(doc.get("rrf_score") or 0.0) for doc in docs])

    scored: list[dict[str, Any]] = []
    for index, doc in enumerate(docs):
        combined = rerank_weight * rr[index] + rrf_weight * rf[index] if fuse else rr[index]
        scored.append({**doc, "combined_score": combined})

    if not episode_aware:
        for doc in scored:
            doc["video_score"] = doc["combined_score"]
        scored.sort(key=lambda item: item["combined_score"], reverse=True)
        return scored

    grouped: dict[Any, list[float]] = defaultdict(list)
    for doc in scored:
        grouped[doc.get("video_id")].append(doc["combined_score"])
    video_score: dict[Any, float] = {}
    for video_id, combos in grouped.items():
        top = max(combos)
        video_score[video_id] = top + episode_damp * (sum(combos) - top)

    for doc in scored:
        doc["video_score"] = video_score[doc.get("video_id")]
        doc["agg_score"] = doc["video_score"]  # backward-compatible alias

    scored.sort(key=lambda item: (item["video_score"], item["combined_score"]), reverse=True)
    return scored


class VoyageReranker:
    def __init__(self, cfg: Settings | None = None):
        self.cfg = cfg or settings()
        if not self.cfg.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is required for reranking.")
        import voyageai

        self.client = voyageai.Client(api_key=self.cfg.voyage_api_key)

    def rerank(
        self,
        query: str,
        docs: list[dict[str, Any]],
        top_k: int = 8,
        *,
        fuse: bool = True,
        episode_aware: bool = True,
    ) -> list[dict[str, Any]]:
        if not docs:
            return []
        texts = [format_for_rerank(doc) for doc in docs]
        # Score ALL candidates (not just top_k) so fusion/aggregation sees the full
        # set; rerank-2.5 accepts <=1000 docs per call.
        result = self.client.rerank(query, texts, model=self.cfg.rerank_model)
        scored: list[dict[str, Any]] = []
        for item in result.results:
            doc = dict(docs[item.index])
            doc["rerank_score"] = item.relevance_score
            scored.append(doc)
        ranked = fuse_and_aggregate(scored, fuse=fuse, episode_aware=episode_aware)
        return ranked[:top_k]


def rerank(
    query: str,
    docs: list[dict[str, Any]],
    top_k: int = 8,
    *,
    fuse: bool = True,
    episode_aware: bool = True,
) -> list[dict[str, Any]]:
    return VoyageReranker().rerank(
        query, docs, top_k=top_k, fuse=fuse, episode_aware=episode_aware
    )
