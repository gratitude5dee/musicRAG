from __future__ import annotations

import argparse
import time
from collections import defaultdict
from typing import Iterable

from pymongo import UpdateOne

from musicrag.common import utc_now_iso
from musicrag.config import Settings, get_db, settings
from musicrag.ingest.chunk import iter_chunk_records


def estimate_tokens(text: str) -> int:
    try:
        import tiktoken

        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return max(1, len(text.split()) * 4 // 3)


def group_by_token_budget(records: list[dict], budget: int) -> list[list[dict]]:
    groups: list[list[dict]] = []
    current: list[dict] = []
    current_tokens = 0
    for record in records:
        tokens = int(record.get("token_count") or estimate_tokens(record["text"]))
        if current and current_tokens + tokens > budget:
            groups.append(current)
            current = []
            current_tokens = 0
        current.append(record)
        current_tokens += tokens
    if current:
        groups.append(current)
    return groups


class VoyageEmbedder:
    def __init__(self, cfg: Settings):
        if not cfg.voyage_api_key:
            raise RuntimeError("VOYAGE_API_KEY is required for embedding.")
        import voyageai

        self.cfg = cfg
        self.client = voyageai.Client(api_key=cfg.voyage_api_key)

    def contextualized(self, texts: list[str], model: str) -> list[list[float]]:
        result = self.client.contextualized_embed(inputs=[texts], model=model, input_type="document")
        return result.results[0].embeddings

    def documents(self, texts: list[str], model: str) -> list[list[float]]:
        return self.client.embed(texts, model=model, input_type="document").embeddings

    def embed_group(self, texts: list[str]) -> tuple[list[list[float]], str]:
        if self.cfg.embed_model == "voyage-context-4":
            try:
                return self.contextualized(texts, self.cfg.embed_model), self.cfg.embed_model
            except Exception:
                return self.documents(texts, self.cfg.embed_fallback_model), self.cfg.embed_fallback_model
        return self.documents(texts, self.cfg.embed_model), self.cfg.embed_model


def existing_chunk_state(chunk_uids: list[str]) -> dict[str, dict]:
    if not chunk_uids:
        return {}
    cursor = get_db().chunks.find(
        {"chunk_uid": {"$in": chunk_uids}},
        {"_id": 0, "chunk_uid": 1, "content_hash": 1, "embed_dims": 1, "embedding": 1},
    )
    return {doc["chunk_uid"]: doc for doc in cursor}


def needs_embedding(record: dict, existing: dict | None, dims: int) -> bool:
    if not existing:
        return True
    embedding = existing.get("embedding")
    return (
        existing.get("content_hash") != record.get("content_hash")
        or existing.get("embed_dims") != dims
        or not isinstance(embedding, list)
        or len(embedding) != dims
    )


def validate_embeddings(embeddings: Iterable[list[float]], dims: int) -> None:
    for idx, embedding in enumerate(embeddings):
        if len(embedding) != dims:
            raise ValueError(f"Embedding {idx} has {len(embedding)} dims; expected {dims}.")


def upsert_embedded_records(records: list[dict], embeddings: list[list[float]], model: str, dims: int) -> None:
    validate_embeddings(embeddings, dims)
    now = utc_now_iso()
    operations = []
    for record, embedding in zip(records, embeddings, strict=True):
        doc = dict(record)
        doc.update(
            {
                "embedding": embedding,
                "embed_model": model,
                "embed_dims": dims,
                "ingested_at": now,
            }
        )
        operations.append(UpdateOne({"chunk_uid": doc["chunk_uid"]}, {"$set": doc}, upsert=True))
    if operations:
        get_db().chunks.bulk_write(operations, ordered=False)


def update_episode_chunk_count(video_id: str, chunk_count: int) -> None:
    get_db().episodes.update_one({"video_id": video_id}, {"$set": {"chunk_count": chunk_count}})


def embed_episode_records(cfg: Settings, embedder: VoyageEmbedder, records: list[dict]) -> tuple[int, int]:
    existing = existing_chunk_state([record["chunk_uid"] for record in records])
    pending = [record for record in records if needs_embedding(record, existing.get(record["chunk_uid"]), cfg.embed_dims)]
    skipped = len(records) - len(pending)
    written = 0
    for group in group_by_token_budget(pending, cfg.context_group_token_budget):
        embeddings, model = embedder.embed_group([record["text"] for record in group])
        upsert_embedded_records(group, embeddings, model, cfg.embed_dims)
        written += len(group)
    if records:
        update_episode_chunk_count(records[0]["video_id"], len(records))
    return written, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed chunks with Voyage and upsert into MongoDB.")
    parser.add_argument("--resume", action="store_true", help="Skip unchanged chunks. This is the default behavior.")
    parser.add_argument("--sample", type=int)
    parser.add_argument("--sleep", type=float, default=0.0, help="Optional pause between episodes.")
    args = parser.parse_args()

    cfg = settings()
    embedder = VoyageEmbedder(cfg)
    total_written = 0
    total_skipped = 0
    for row, records in iter_chunk_records(cfg, args.sample):
        written, skipped = embed_episode_records(cfg, embedder, records)
        total_written += written
        total_skipped += skipped
        print({"video_id": row.video_id, "written": written, "skipped": skipped, "chunks": len(records)})
        if args.sleep:
            time.sleep(args.sleep)
    print({"written": total_written, "skipped": total_skipped})


if __name__ == "__main__":
    main()

