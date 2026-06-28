from __future__ import annotations

from typing import Any

from musicrag.config import Settings, settings


class VoyageReranker:
    def __init__(self, cfg: Settings | None = None):
        self.cfg = cfg or settings()
        if not self.cfg.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is required for reranking.")
        import voyageai

        self.client = voyageai.Client(api_key=self.cfg.voyage_api_key)

    def rerank(self, query: str, docs: list[dict[str, Any]], top_k: int = 8) -> list[dict[str, Any]]:
        if not docs:
            return []
        texts = [doc["text"] for doc in docs]
        result = self.client.rerank(query, texts, model=self.cfg.rerank_model, top_k=min(top_k, len(docs)))
        reranked: list[dict[str, Any]] = []
        for item in result.results:
            doc = dict(docs[item.index])
            doc["rerank_score"] = item.relevance_score
            reranked.append(doc)
        return reranked


def rerank(query: str, docs: list[dict[str, Any]], top_k: int = 8) -> list[dict[str, Any]]:
    return VoyageReranker().rerank(query, docs, top_k=top_k)

