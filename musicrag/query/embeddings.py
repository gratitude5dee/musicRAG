from __future__ import annotations

from musicrag.config import Settings, settings


class QueryEmbedder:
    def __init__(self, cfg: Settings | None = None):
        self.cfg = cfg or settings()
        if not self.cfg.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is required to embed queries.")
        import voyageai

        self.client = voyageai.Client(api_key=self.cfg.voyage_api_key)

    def embed_query(self, query: str) -> list[float]:
        model = self.cfg.embed_fallback_model if self.cfg.embed_model == "voyage-context-4" else self.cfg.embed_model
        embedding = self.client.embed([query], model=model, input_type="query").embeddings[0]
        if len(embedding) != self.cfg.embed_dims:
            raise ValueError(f"Query embedding has {len(embedding)} dims; expected {self.cfg.embed_dims}.")
        return embedding

