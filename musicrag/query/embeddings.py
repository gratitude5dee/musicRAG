from __future__ import annotations

from musicrag.config import Settings, settings


def select_query_embedding(embed_model: str, fallback_model: str) -> tuple[str, bool]:
    """Choose how to embed a *query* so it lands in the same space as the corpus.

    Returns ``(model_name, use_contextualized)``.

    The corpus is embedded with ``embed_model``. The previous implementation
    embedded queries with the *fallback* model whenever the corpus used
    ``voyage-context-4`` - i.e. document vectors (context-4) and query vectors
    (voyage-4-large) came from different models. They share dimensionality so the
    index accepts both, but the spaces are not identical, which quietly costs
    recall. Align them instead:

    * corpus ``voyage-context-4`` -> embed the query with ``voyage-context-4`` via
      the contextualized endpoint (a single input, ``input_type="query"``).
    * otherwise -> embed the query with the same model via the standard endpoint.

    ``embed_model`` must reflect what ingestion actually used (it is recorded per
    chunk as ``embed_model``); keep ``EMBED_MODEL`` in ``.env`` in sync with the
    corpus.
    """
    if embed_model == "voyage-context-4":
        return "voyage-context-4", True
    return embed_model or fallback_model, False


class QueryEmbedder:
    def __init__(self, cfg: Settings | None = None):
        self.cfg = cfg or settings()
        if not self.cfg.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is required to embed queries.")
        import voyageai

        self.client = voyageai.Client(api_key=self.cfg.voyage_api_key)

    def _embed(self, query: str, model: str, contextualized: bool) -> list[float]:
        if contextualized:
            try:
                result = self.client.contextualized_embed(
                    inputs=[[query]], model=model, input_type="query"
                )
                return result.results[0].embeddings[0]
            except Exception:
                # Stay in the same model family if the contextualized endpoint is
                # unavailable rather than silently dropping to a different model.
                return self.client.embed([query], model=model, input_type="query").embeddings[0]
        return self.client.embed([query], model=model, input_type="query").embeddings[0]

    def embed_query(self, query: str) -> list[float]:
        model, contextualized = select_query_embedding(
            self.cfg.embed_model, self.cfg.embed_fallback_model
        )
        embedding = self._embed(query, model, contextualized)
        if len(embedding) != self.cfg.embed_dims:
            raise ValueError(
                f"Query embedding has {len(embedding)} dims; expected {self.cfg.embed_dims}."
            )
        return embedding
