from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from musicrag.config import get_db
from musicrag.query.embeddings import QueryEmbedder


@dataclass(frozen=True)
class SearchFilters:
    channel: str | None = None
    guest: str | None = None
    topic: str | None = None
    date_from_ts: int | None = None
    date_to_ts: int | None = None

    @classmethod
    def from_mapping(cls, raw: dict[str, Any] | None) -> "SearchFilters":
        raw = raw or {}
        return cls(
            channel=raw.get("channel") or None,
            guest=raw.get("guest") or raw.get("guests") or None,
            topic=raw.get("topic") or raw.get("topics") or None,
            date_from_ts=raw.get("date_from_ts"),
            date_to_ts=raw.get("date_to_ts"),
        )

    def to_vector_filter(self) -> dict[str, Any] | None:
        clauses: list[dict[str, Any]] = []
        if self.channel:
            clauses.append({"channel": self.channel})
        if self.guest:
            clauses.append({"guests": {"$eq": self.guest}})
        if self.topic:
            clauses.append({"topics": {"$eq": self.topic}})
        if self.date_from_ts is not None or self.date_to_ts is not None:
            range_filter: dict[str, Any] = {}
            if self.date_from_ts is not None:
                range_filter["$gte"] = self.date_from_ts
            if self.date_to_ts is not None:
                range_filter["$lte"] = self.date_to_ts
            clauses.append({"upload_ts": range_filter})
        if not clauses:
            return None
        if len(clauses) == 1:
            return clauses[0]
        return {"$and": clauses}


SOURCE_PROJECTION = {
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


def vector_search(query_vector: list[float], filters: SearchFilters, limit: int = 40, num_candidates: int = 200) -> list[dict]:
    stage: dict[str, Any] = {
        "index": "vector_index",
        "path": "embedding",
        "queryVector": query_vector,
        "numCandidates": num_candidates,
        "limit": limit,
    }
    vector_filter = filters.to_vector_filter()
    if vector_filter:
        stage["filter"] = vector_filter
    pipeline = [
        {"$vectorSearch": stage},
        {"$project": {**SOURCE_PROJECTION, "score": {"$meta": "vectorSearchScore"}}},
    ]
    return list(get_db().chunks.aggregate(pipeline))


def full_text_search(query: str, filters: SearchFilters, limit: int = 40) -> list[dict]:
    compound: dict[str, Any] = {
        "must": [{"text": {"query": query, "path": ["text", "title", "guests", "topics"]}}]
    }
    match_filter = filters.to_vector_filter()
    pipeline = [
        {"$search": {"index": "text_index", "compound": compound}},
        {"$project": {**SOURCE_PROJECTION, "score": {"$meta": "searchScore"}}},
    ]
    if match_filter:
        pipeline.insert(1, {"$match": match_filter})
    pipeline.insert(-1, {"$limit": limit})
    return list(get_db().chunks.aggregate(pipeline))


def reciprocal_rank_fusion(
    vector_results: list[dict],
    text_results: list[dict],
    filters: SearchFilters,
    k: int = 60,
) -> list[dict]:
    fused: dict[str, dict] = {}
    for source_name, results, weight in (("vector", vector_results, 1.0), ("text", text_results, 0.85)):
        for rank, doc in enumerate(results, start=1):
            key = doc["chunk_uid"]
            if key not in fused:
                fused[key] = {**doc, "rrf_score": 0.0, "signals": {}}
            fused[key]["rrf_score"] += weight * (1.0 / (k + rank))
            fused[key]["signals"][source_name] = {"rank": rank, "score": doc.get("score")}

    for doc in fused.values():
        if filters.guest and filters.guest in (doc.get("guests") or []):
            doc["rrf_score"] += 0.01
        if filters.topic and filters.topic in (doc.get("topics") or []):
            doc["rrf_score"] += 0.01
    return sorted(fused.values(), key=lambda item: item["rrf_score"], reverse=True)


def widen_with_neighbors(results: list[dict], max_neighbors: int = 1) -> list[dict]:
    if max_neighbors <= 0 or not results:
        return results
    db = get_db()
    by_key = {doc["chunk_uid"]: doc for doc in results}
    for doc in list(results):
        video_id = doc.get("video_id")
        chunk_index = doc.get("chunk_index")
        if video_id is None or chunk_index is None:
            continue
        neighbor_indexes = [chunk_index + offset for offset in range(-max_neighbors, max_neighbors + 1) if offset]
        for neighbor in db.chunks.find(
            {"video_id": video_id, "chunk_index": {"$in": neighbor_indexes}},
            SOURCE_PROJECTION,
        ):
            by_key.setdefault(neighbor["chunk_uid"], {**neighbor, "rrf_score": doc["rrf_score"] * 0.65, "signals": {"neighbor": True}})
    return sorted(by_key.values(), key=lambda item: item.get("rrf_score", 0), reverse=True)


def retrieve(query: str, filters: dict[str, Any] | None = None, limit: int = 40, widen: bool = False) -> list[dict]:
    parsed_filters = SearchFilters.from_mapping(filters)
    query_vector = QueryEmbedder().embed_query(query)
    vec = vector_search(query_vector, parsed_filters, limit=limit)
    text = full_text_search(query, parsed_filters, limit=limit)
    fused = reciprocal_rank_fusion(vec, text, parsed_filters)
    if widen:
        fused = widen_with_neighbors(fused[: min(limit, 20)])
    return fused[:limit]
