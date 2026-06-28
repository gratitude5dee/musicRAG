from __future__ import annotations

import json
from typing import Any

import requests

from musicrag.config import Settings, settings

SYSTEM_PROMPT = """You answer questions about the music industry using ONLY the provided transcript excerpts.
Cite every factual claim inline as [Title @ mm:ss](deep_link). If the excerpts do not contain the answer,
say so. Never invent quotes, names, numbers, or sources. Prefer concrete guidance and attribute who said it
when the source makes that clear."""


def seconds_to_mmss(seconds: float | int | None) -> str:
    if seconds is None:
        return "no timestamp"
    seconds = int(seconds)
    return f"{seconds // 60}:{seconds % 60:02d}"


def source_payload(doc: dict[str, Any]) -> dict[str, Any]:
    snippet = doc.get("text", "")
    if len(snippet) > 700:
        snippet = snippet[:697].rstrip() + "..."
    return {
        "title": doc.get("title"),
        "channel": doc.get("channel"),
        "guests": doc.get("guests") or [],
        "video_id": doc.get("video_id"),
        "start_sec": doc.get("start_sec"),
        "end_sec": doc.get("end_sec"),
        "deep_link": doc.get("deep_link"),
        "snippet": snippet,
        "score": doc.get("rerank_score", doc.get("rrf_score")),
    }


def build_context(docs: list[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for idx, doc in enumerate(docs, start=1):
        title = doc.get("title") or "Untitled"
        timestamp = seconds_to_mmss(doc.get("start_sec"))
        link = doc.get("deep_link") or ""
        blocks.append(
            f"Source {idx}: {title} @ {timestamp}\n"
            f"Channel: {doc.get('channel')}\n"
            f"Guests: {', '.join(doc.get('guests') or [])}\n"
            f"Link: {link}\n"
            f"Excerpt: {doc.get('text')}\n"
        )
    return "\n---\n".join(blocks)


def generate_answer(query: str, docs: list[dict[str, Any]], cfg: Settings | None = None) -> dict[str, Any]:
    cfg = cfg or settings()
    if not cfg.ai_gateway_api_key:
        raise RuntimeError("AI_GATEWAY_API_KEY is required for answer generation.")
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Question: {query}\n\n"
                f"Transcript excerpts:\n{build_context(docs)}\n\n"
                "Answer with concise synthesis and citations."
            ),
        },
    ]
    response = requests.post(
        "https://ai-gateway.vercel.sh/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {cfg.ai_gateway_api_key}",
            "Content-Type": "application/json",
        },
        json={"model": cfg.generation_model, "messages": messages, "temperature": 0.2},
        timeout=60,
    )
    response.raise_for_status()
    data = response.json()
    answer = data["choices"][0]["message"]["content"]
    return {"answer": answer, "sources": [source_payload(doc) for doc in docs]}


def to_json(result: dict[str, Any]) -> str:
    return json.dumps(result, ensure_ascii=False, indent=2)

