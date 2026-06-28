from __future__ import annotations

import argparse
import json
from pathlib import Path

from musicrag.query.rerank import rerank
from musicrag.query.retrieve import retrieve


def reciprocal_rank(results: list[dict], expected_video_ids: set[str]) -> float:
    for rank, doc in enumerate(results, start=1):
        if doc.get("video_id") in expected_video_ids:
            return 1.0 / rank
    return 0.0


def recall_at_k(results: list[dict], expected_video_ids: set[str], k: int) -> float:
    if not expected_video_ids:
        return 0.0
    found = {doc.get("video_id") for doc in results[:k]} & expected_video_ids
    return len(found) / len(expected_video_ids)


def load_golden(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run MusicRAG retrieval evaluation.")
    parser.add_argument("--golden", type=Path, default=Path("eval/golden.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("eval/report.md"))
    args = parser.parse_args()

    items = load_golden(args.golden)
    rows: list[dict] = []
    for item in items:
        filters = {key: item[key] for key in ("channel", "guest", "topic") if item.get(key)}
        fused = retrieve(item["q"], filters=filters, limit=40)
        ranked = rerank(item["q"], fused, top_k=10)
        expected = set(item["expected_video_ids"])
        rows.append(
            {
                "q": item["q"],
                "recall10": recall_at_k(ranked, expected, 10),
                "mrr10": reciprocal_rank(ranked[:10], expected),
                "top_video_ids": [doc.get("video_id") for doc in ranked[:10]],
            }
        )
    recall10 = sum(row["recall10"] for row in rows) / max(1, len(rows))
    mrr10 = sum(row["mrr10"] for row in rows) / max(1, len(rows))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        "# MusicRAG Eval Report\n\n"
        f"- Questions: {len(rows)}\n"
        f"- Recall@10: {recall10:.3f}\n"
        f"- MRR@10: {mrr10:.3f}\n\n"
        "```json\n" + json.dumps(rows, ensure_ascii=False, indent=2) + "\n```\n",
        encoding="utf-8",
    )
    print({"questions": len(rows), "recall10": recall10, "mrr10": mrr10})


if __name__ == "__main__":
    main()

