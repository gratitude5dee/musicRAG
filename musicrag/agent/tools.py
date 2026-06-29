from __future__ import annotations

import re
from typing import Any, Optional

from musicrag.agent.intent import Vocabulary
from musicrag.common import slugify

EPISODE_PROJECTION = {
    "_id": 0,
    "video_id": 1,
    "channel": 1,
    "title": 1,
    "guests": 1,
    "topics": 1,
    "upload_date": 1,
    "upload_ts": 1,
    "video_url": 1,
    "chunk_count": 1,
}

CHUNK_PROJECTION = {
    "_id": 0,
    "chunk_uid": 1,
    "video_id": 1,
    "channel": 1,
    "title": 1,
    "text": 1,
    "guests": 1,
    "topics": 1,
    "start_sec": 1,
    "end_sec": 1,
    "deep_link": 1,
    "chunk_index": 1,
}


# --- pure query builders (no DB; unit-testable) ----------------------------------


def guest_episode_query(name: str) -> dict[str, Any]:
    """Match episodes for a guest by exact array membership OR a title mention.

    The title fallback matters because guest extraction is heuristic: some guests
    (e.g. on Rick Rubin's show) are named in the episode title but never said in
    the transcript, so they are invisible to chunk search. This is exactly the
    class of query that currently scores 0.0.
    """
    return {
        "$or": [
            {"guests": name},
            {"title": {"$regex": re.escape(name), "$options": "i"}},
        ]
    }


def topic_episode_query(name: str) -> dict[str, Any]:
    return {"topics": name}


def related_query(video_id: str, guests: list[str], topics: list[str]) -> dict[str, Any]:
    return {
        "video_id": {"$ne": video_id},
        "$or": [
            {"guests": {"$in": guests or []}},
            {"topics": {"$in": topics or []}},
        ],
    }


# --- DB-backed tools (db is injectable for tests) --------------------------------


def _db(db: Any | None):
    if db is not None:
        return db
    from musicrag.config import get_db

    return get_db()


def load_vocabulary(db: Any | None = None) -> Vocabulary:
    """Build the matcher vocabulary from the context-graph collections."""
    database = _db(db)
    guests: dict[str, str] = {}
    topics: dict[str, str] = {}
    channels: dict[str, str] = {}
    for entity in database.entities.find({}, {"name": 1, "type": 1}):
        name = entity.get("name")
        if not name:
            continue
        bucket = guests if entity.get("type") == "guest" else topics
        bucket[name.lower()] = name
    for channel in database.channels.find({}, {"channel": 1}):
        name = channel.get("channel")
        if name:
            channels[name.lower()] = name
    return Vocabulary(guests=guests, channels=channels, topics=topics)


def find_episodes_by_guest(name: str, db: Any | None = None, limit: int = 10) -> list[dict]:
    database = _db(db)
    entity = database.entities.find_one({"type": "guest", "slug": slugify(name)})
    if entity and entity.get("episode_ids"):
        return list(
            database.episodes.find(
                {"video_id": {"$in": entity["episode_ids"]}}, EPISODE_PROJECTION
            ).limit(limit)
        )
    return list(database.episodes.find(guest_episode_query(name), EPISODE_PROJECTION).limit(limit))


def find_episodes_by_topic(name: str, db: Any | None = None, limit: int = 20) -> list[dict]:
    database = _db(db)
    entity = database.entities.find_one({"type": "topic", "slug": slugify(name)})
    if entity and entity.get("episode_ids"):
        return list(
            database.episodes.find(
                {"video_id": {"$in": entity["episode_ids"]}}, EPISODE_PROJECTION
            ).limit(limit)
        )
    return list(database.episodes.find(topic_episode_query(name), EPISODE_PROJECTION).limit(limit))


def related_episodes(video_id: str, db: Any | None = None, limit: int = 5) -> list[dict]:
    database = _db(db)
    episode = database.episodes.find_one({"video_id": video_id}, {"guests": 1, "topics": 1})
    if not episode:
        return []
    query = related_query(video_id, episode.get("guests") or [], episode.get("topics") or [])
    return list(database.episodes.find(query, EPISODE_PROJECTION).limit(limit))


def episode_chunks(video_id: str, db: Any | None = None, limit: int = 12) -> list[dict]:
    database = _db(db)
    return list(
        database.chunks.find({"video_id": video_id}, CHUNK_PROJECTION)
        .sort("chunk_index", 1)
        .limit(limit)
    )
