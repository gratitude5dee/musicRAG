from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterator

from pymongo import UpdateOne

from musicrag.common import sha256_text, utc_now_iso
from musicrag.config import Settings, get_db, settings
from musicrag.ingest.parse_sources import SourceRow, episode_document, read_index
from musicrag.ingest.srt_chunker import chunks_from_episode_files


def youtube_deep_link(video_id: str, start_sec: float | None) -> str | None:
    if start_sec is None:
        return None
    return f"https://www.youtube.com/watch?v={video_id}&t={int(start_sec)}s"


def chunk_uid(video_id: str, chunk_index: int) -> str:
    return f"{video_id}:{chunk_index:04d}"


def episode_dir(root: Path, row: SourceRow) -> Path:
    return root / row.channel / row.folder


def chunk_records_for_row(cfg: Settings, row: SourceRow) -> list[dict]:
    if not row.has_transcript:
        return []
    episode = episode_document(cfg.transcripts_root, row, cfg.schema_version)
    chunks, source_path = chunks_from_episode_files(
        episode_dir(cfg.transcripts_root, row),
        cfg.chunk_tokens,
        cfg.chunk_overlap,
    )
    records: list[dict] = []
    for chunk in chunks:
        records.append(
            {
                "chunk_uid": chunk_uid(row.video_id, chunk.chunk_index),
                "video_id": row.video_id,
                "channel": episode["channel"],
                "title": episode["title"],
                "text": chunk.text,
                "start_sec": chunk.start_sec,
                "end_sec": chunk.end_sec,
                "deep_link": youtube_deep_link(row.video_id, chunk.start_sec),
                "guests": episode.get("guests", []),
                "topics": episode.get("topics", []),
                "upload_date": episode.get("upload_date"),
                "upload_ts": episode.get("upload_ts"),
                "view_count": episode.get("view_count"),
                "caption_type": episode.get("caption_type") or row.caption_type,
                "chunk_index": chunk.chunk_index,
                "chunk_count": len(chunks),
                "token_count": chunk.token_count,
                "word_count": chunk.word_count,
                "content_hash": sha256_text(chunk.text),
                "source_path": source_path,
                "schema_version": cfg.schema_version,
            }
        )
    return records


def iter_chunk_records(cfg: Settings, sample: int | None = None) -> Iterator[tuple[SourceRow, list[dict]]]:
    rows = [row for row in read_index(cfg.transcripts_root) if row.has_transcript]
    if sample is not None:
        rows = rows[:sample]
    for row in rows:
        yield row, chunk_records_for_row(cfg, row)


def upsert_unembedded_chunks(records: list[dict]) -> None:
    if not records:
        return
    now = utc_now_iso()
    operations = []
    for record in records:
        doc = dict(record)
        doc.setdefault("ingested_at", now)
        operations.append(
            UpdateOne(
                {"chunk_uid": doc["chunk_uid"]},
                {"$set": doc, "$setOnInsert": {"embedding": None}},
                upsert=True,
            )
        )
    get_db().chunks.bulk_write(operations, ordered=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Chunk transcript corpus.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sample", type=int)
    parser.add_argument("--write-jsonl", type=Path)
    parser.add_argument("--upsert", action="store_true", help="Upsert chunk metadata without embeddings.")
    args = parser.parse_args()

    cfg = settings()
    total_chunks = 0
    total_episodes = 0
    out = args.write_jsonl.open("w", encoding="utf-8") if args.write_jsonl else None
    try:
        for row, records in iter_chunk_records(cfg, args.sample):
            total_episodes += 1
            total_chunks += len(records)
            if args.dry_run:
                print(json.dumps({"video_id": row.video_id, "chunks": len(records), "sample": records[:1]}, ensure_ascii=False))
            if out:
                for record in records:
                    out.write(json.dumps(record, ensure_ascii=False) + "\n")
            if args.upsert and not args.dry_run:
                upsert_unembedded_chunks(records)
    finally:
        if out:
            out.close()
    print({"episodes": total_episodes, "chunks": total_chunks})


if __name__ == "__main__":
    main()

