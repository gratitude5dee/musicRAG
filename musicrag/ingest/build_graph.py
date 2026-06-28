from __future__ import annotations

import argparse

from pymongo import ReplaceOne

from musicrag.common import slugify
from musicrag.config import get_db, settings


def rebuild_entities_from_episodes() -> int:
    cfg = settings()
    db = get_db()
    grouped: dict[tuple[str, str], dict] = {}
    for episode in db.episodes.find({}, {"video_id": 1, "channel": 1, "guests": 1, "topics": 1}):
        for entity_type, values in (("guest", episode.get("guests") or []), ("topic", episode.get("topics") or [])):
            for name in values:
                key = (entity_type, slugify(name))
                doc = grouped.setdefault(
                    key,
                    {
                        "name": name,
                        "type": entity_type,
                        "slug": slugify(name),
                        "episode_ids": set(),
                        "channels": set(),
                        "schema_version": cfg.schema_version,
                    },
                )
                doc["episode_ids"].add(episode["video_id"])
                doc["channels"].add(episode["channel"])
    operations = []
    for doc in grouped.values():
        doc["episode_ids"] = sorted(doc["episode_ids"])
        doc["channels"] = sorted(doc["channels"])
        doc["episode_count"] = len(doc["episode_ids"])
        operations.append(ReplaceOne({"type": doc["type"], "slug": doc["slug"]}, doc, upsert=True))
    if operations:
        db.entities.bulk_write(operations, ordered=False)
    return len(operations)


def sync_episode_chunk_counts() -> int:
    db = get_db()
    count = 0
    pipeline = [{"$group": {"_id": "$video_id", "chunk_count": {"$sum": 1}}}]
    for row in db.chunks.aggregate(pipeline):
        db.episodes.update_one({"video_id": row["_id"]}, {"$set": {"chunk_count": row["chunk_count"]}})
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description="Finalize MusicRAG graph fields.")
    parser.parse_args()
    entity_count = rebuild_entities_from_episodes()
    episode_count = sync_episode_chunk_counts()
    print({"entities": entity_count, "episodes_with_chunks": episode_count})


if __name__ == "__main__":
    main()

