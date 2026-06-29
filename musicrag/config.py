from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus

import certifi
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

_mongo_client: Optional[MongoClient] = None


def normalize_mongodb_host(host: str) -> str:
    host = host.strip()
    if host.startswith("mongodb+srv://"):
        host = host.removeprefix("mongodb+srv://")
    elif host.startswith("mongodb://"):
        host = host.removeprefix("mongodb://")
    return host.split("/", 1)[0]


def build_mongodb_uri(
    explicit_uri: str,
    host: str,
    username: str,
    password: str,
    options: str = "retryWrites=true&w=majority&appName=musicRAG",
) -> str:
    if explicit_uri:
        return explicit_uri
    if not (host and username and password):
        return ""
    normalized_host = normalize_mongodb_host(host)
    encoded_user = quote_plus(username)
    encoded_password = quote_plus(password)
    suffix = f"?{options.lstrip('?')}" if options else ""
    return f"mongodb+srv://{encoded_user}:{encoded_password}@{normalized_host}/{suffix}"


@dataclass(frozen=True)
class Settings:
    mongodb_uri: str
    mongodb_db: str
    transcripts_root: Path
    voyage_api_key: str
    embed_model: str
    embed_fallback_model: str
    embed_dims: int
    rerank_model: str
    ai_gateway_api_key: str
    generation_model: str
    chunk_tokens: int
    chunk_overlap: int
    context_group_token_budget: int
    schema_version: int

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(os.getenv("TRANSCRIPTS_ROOT", "../musicindustrytranscripts/transcripts"))
        mongodb_uri = build_mongodb_uri(
            explicit_uri=os.getenv("MONGODB_URI", ""),
            host=os.getenv("MONGODB_HOST", ""),
            username=os.getenv("MONGODB_USERNAME", ""),
            password=os.getenv("MONGODB_PASSWORD", ""),
            options=os.getenv("MONGODB_OPTIONS", "retryWrites=true&w=majority&appName=musicRAG"),
        )
        return cls(
            mongodb_uri=mongodb_uri,
            mongodb_db=os.getenv("MONGODB_DB", "music_rag"),
            transcripts_root=root,
            voyage_api_key=os.getenv("VOYAGE_API_KEY", ""),
            embed_model=os.getenv("EMBED_MODEL", "voyage-context-4"),
            embed_fallback_model=os.getenv("EMBED_FALLBACK_MODEL", "voyage-4-large"),
            embed_dims=int(os.getenv("EMBED_DIMS", "1024")),
            rerank_model=os.getenv("RERANK_MODEL", "rerank-2.5"),
            ai_gateway_api_key=os.getenv("AI_GATEWAY_API_KEY", ""),
            generation_model=os.getenv("GENERATION_MODEL", "google/gemini-3.5-flash"),
            chunk_tokens=int(os.getenv("CHUNK_TOKENS", "500")),
            chunk_overlap=int(os.getenv("CHUNK_OVERLAP", "75")),
            context_group_token_budget=int(os.getenv("CONTEXT_GROUP_TOKEN_BUDGET", "28000")),
            schema_version=int(os.getenv("SCHEMA_VERSION", "1")),
        )


def settings() -> Settings:
    return Settings.from_env()


def get_mongo_client(uri: str | None = None) -> MongoClient:
    """Return one process-wide MongoClient.

    Pool sizing is intentionally left at driver defaults until real deployment
    concurrency and Atlas connection metrics are available.
    """
    global _mongo_client
    resolved_uri = uri or settings().mongodb_uri
    if not resolved_uri:
        raise RuntimeError("MONGODB_URI is required for MongoDB operations.")
    if _mongo_client is None:
        _mongo_client = MongoClient(resolved_uri, tlsCAFile=certifi.where())
    return _mongo_client


def get_db():
    cfg = settings()
    return get_mongo_client(cfg.mongodb_uri)[cfg.mongodb_db]
