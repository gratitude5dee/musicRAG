from __future__ import annotations

import argparse
import time
from typing import Any

from pymongo.errors import OperationFailure
from pymongo.operations import SearchIndexModel

from musicrag.config import get_db

VECTOR_INDEX_NAME = "vector_index"
TEXT_INDEX_NAME = "text_index"

VECTOR_INDEX_DEFINITION: dict[str, Any] = {
    "fields": [
        {"type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "dotProduct"},
        {"type": "filter", "path": "channel"},
        {"type": "filter", "path": "guests"},
        {"type": "filter", "path": "topics"},
        {"type": "filter", "path": "video_id"},
        {"type": "filter", "path": "caption_type"},
        {"type": "filter", "path": "upload_ts"},
    ]
}

TEXT_INDEX_DEFINITION: dict[str, Any] = {
    "mappings": {
        "dynamic": False,
        "fields": {
            "text": {"type": "string", "analyzer": "lucene.english"},
            "title": {"type": "string", "analyzer": "lucene.english"},
            "guests": {"type": "string"},
            "topics": {"type": "string"},
        },
    }
}


def list_search_indexes(collection) -> dict[str, dict]:
    try:
        return {idx["name"]: idx for idx in collection.list_search_indexes()}
    except OperationFailure:
        return {}


def ensure_standard_indexes() -> None:
    db = get_db()
    db.chunks.create_index("chunk_uid", unique=True)
    db.chunks.create_index([("video_id", 1), ("chunk_index", 1)])
    db.episodes.create_index("video_id", unique=True)
    db.episodes.create_index("channel")
    db.episodes.create_index("guests")
    db.episodes.create_index("topics")
    db.episodes.create_index([("upload_ts", -1)])
    db.entities.create_index([("type", 1), ("slug", 1)], unique=True)
    db.entities.create_index("episode_ids")
    db.channels.create_index("channel", unique=True)


def ensure_search_index(collection, name: str, index_type: str | None, definition: dict, force: bool = False) -> None:
    existing = list_search_indexes(collection)
    if name in existing and not force:
        return
    if name in existing and force:
        collection.drop_search_index(name)
        wait_until_index_absent(collection, name)
    kwargs: dict[str, Any] = {"name": name, "definition": definition}
    if index_type:
        kwargs["type"] = index_type
    collection.create_search_index(SearchIndexModel(**kwargs))


def wait_until_index_absent(collection, name: str, timeout: int = 300) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if name not in list_search_indexes(collection):
            return
        time.sleep(5)
    raise TimeoutError(f"Search index {name} still exists after {timeout}s.")


def wait_until_queryable(collection, names: list[str], timeout: int = 1800) -> None:
    deadline = time.time() + timeout
    pending = set(names)
    while pending and time.time() < deadline:
        indexes = list_search_indexes(collection)
        for name in list(pending):
            if indexes.get(name, {}).get("queryable") is True:
                pending.remove(name)
        if pending:
            print(f"Waiting for search indexes: {', '.join(sorted(pending))}")
            time.sleep(15)
    if pending:
        raise TimeoutError(f"Search indexes not queryable after {timeout}s: {sorted(pending)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create MusicRAG MongoDB indexes.")
    parser.add_argument("--force", action="store_true", help="Drop and recreate search indexes.")
    parser.add_argument("--yes", action="store_true", help="Confirm destructive --force.")
    parser.add_argument("--skip-wait", action="store_true")
    args = parser.parse_args()

    if args.force and not args.yes:
        raise SystemExit("--force drops search indexes. Re-run with --force --yes to confirm.")

    ensure_standard_indexes()
    chunks = get_db().chunks
    ensure_search_index(chunks, VECTOR_INDEX_NAME, "vectorSearch", VECTOR_INDEX_DEFINITION, force=args.force)
    ensure_search_index(chunks, TEXT_INDEX_NAME, None, TEXT_INDEX_DEFINITION, force=args.force)
    if not args.skip_wait:
        wait_until_queryable(chunks, [VECTOR_INDEX_NAME, TEXT_INDEX_NAME])
    print("Indexes are configured.")


if __name__ == "__main__":
    main()

