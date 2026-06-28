from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from musicrag.config import get_mongo_client, settings
from musicrag.ingest.parse_sources import read_index


@dataclass
class Check:
    name: str
    status: str
    evidence: str


def ok(name: str, evidence: str) -> Check:
    return Check(name, "pass", evidence)


def fail(name: str, evidence: str) -> Check:
    return Check(name, "fail", evidence)


def warn(name: str, evidence: str) -> Check:
    return Check(name, "warn", evidence)


def env_check() -> list[Check]:
    required = ["MONGODB_URI", "VOYAGE_API_KEY", "AI_GATEWAY_API_KEY"]
    checks = []
    for key in required:
        checks.append(
            ok(f"env:{key}", "set") if os.getenv(key) else fail(f"env:{key}", "missing")
        )
    if os.getenv("MDB_MCP_CONNECTION_STRING") or (
        os.getenv("MDB_MCP_API_CLIENT_ID") and os.getenv("MDB_MCP_API_CLIENT_SECRET")
    ):
        checks.append(ok("env:mongodb_mcp", "MongoDB MCP auth env is set"))
    else:
        checks.append(
            warn(
                "env:mongodb_mcp",
                "MongoDB MCP auth env is not set; runtime can still use MONGODB_URI",
            )
        )
    return checks


def corpus_check(transcripts_root: Path) -> list[Check]:
    try:
        rows = read_index(transcripts_root)
    except Exception as exc:
        return [fail("corpus:index", f"{type(exc).__name__}: {exc}")]
    transcribed = [row for row in rows if row.has_transcript]
    channels = {row.channel for row in rows}
    return [
        ok("corpus:episodes", f"{len(rows)} indexed episodes"),
        ok("corpus:transcribed", f"{len(transcribed)} episodes with transcripts"),
        ok("corpus:channels", f"{len(channels)} channels"),
    ]


def search_index_state(collection) -> dict[str, Any]:
    try:
        return {idx["name"]: idx for idx in collection.list_search_indexes()}
    except Exception as exc:
        return {"_error": str(exc)}


def db_check() -> list[Check]:
    cfg = settings()
    if not cfg.mongodb_uri:
        return [fail("db:connect", "MONGODB_URI missing")]
    checks: list[Check] = []
    try:
        client = get_mongo_client(cfg.mongodb_uri)
        client.admin.command("ping")
        db = client[cfg.mongodb_db]
        checks.append(ok("db:connect", f"ping ok for {cfg.mongodb_db}"))
    except Exception as exc:
        return [fail("db:connect", f"{type(exc).__name__}: {exc}")]

    episode_count = db.episodes.count_documents({})
    channel_count = db.channels.count_documents({})
    chunks_count = db.chunks.count_documents({})
    embedded_count = db.chunks.count_documents({"embedding": {"$type": "array"}})
    missing_embedding = db.chunks.count_documents(
        {"$or": [{"embedding": {"$exists": False}}, {"embedding": None}]}
    )
    checks.extend(
        [
            ok("db:episodes", f"{episode_count} episode docs")
            if episode_count == 1087
            else fail("db:episodes", f"{episode_count} episode docs; expected 1087"),
            ok("db:channels", f"{channel_count} channel docs")
            if channel_count == 9
            else fail("db:channels", f"{channel_count} channel docs; expected 9"),
            ok("db:chunks", f"{chunks_count} chunk docs")
            if chunks_count
            else fail("db:chunks", "no chunks found"),
            ok("db:embeddings", f"{embedded_count} chunks with array embeddings")
            if chunks_count and embedded_count == chunks_count and missing_embedding == 0
            else fail(
                "db:embeddings",
                f"{embedded_count}/{chunks_count} chunks embedded; missing={missing_embedding}",
            ),
        ]
    )
    sample = db.chunks.find_one(
        {"embedding": {"$type": "array"}},
        {"embedding": {"$slice": 1025}},
    )
    if sample:
        dims = len(sample.get("embedding") or [])
        checks.append(
            ok("db:embedding_dims", "sample embedding has 1024 dims")
            if dims == 1024
            else fail("db:embedding_dims", f"sample embedding has {dims} dims")
        )
    else:
        checks.append(fail("db:embedding_dims", "no embedded chunk sample found"))

    indexes = search_index_state(db.chunks)
    if "_error" in indexes:
        checks.append(fail("db:search_indexes", indexes["_error"]))
    else:
        for name in ["vector_index", "text_index"]:
            state = indexes.get(name, {})
            checks.append(
                ok(f"db:index:{name}", "queryable:true")
                if state.get("queryable") is True
                else fail(
                    f"db:index:{name}",
                    f"state={state.get('status')} queryable={state.get('queryable')}",
                )
            )
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit MusicRAG acceptance gates.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    cfg = settings()
    checks = env_check() + corpus_check(cfg.transcripts_root) + db_check()
    payload = {"checks": [asdict(check) for check in checks]}
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        for check in checks:
            print(f"[{check.status}] {check.name}: {check.evidence}")
    failed = [check for check in checks if check.status == "fail"]
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
