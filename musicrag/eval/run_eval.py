from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from musicrag.query.rerank import rerank
from musicrag.query.retrieve import retrieve

MIN_GOLDEN_QUESTIONS = 40
MIN_GOLDEN_CHANNELS = 12
TARGET_RECALL10 = 0.85
TARGET_MRR10 = 0.60


def reciprocal_rank(results: list[dict], expected_video_ids: set[str]) -> float:
    for rank, doc in enumerate(results, start=1):
        if doc.get("video_id") in expected_video_ids:
            return 1.0 / rank
    return 0.0


def recall_at_k(results: list[dict], expected_video_ids: set[str], k: int) -> float:
    if not expected_video_ids:
        return 0.0
    found = {
        doc.get("video_id") for doc in results[:k] if doc.get("video_id")
    } & expected_video_ids
    return len(found) / len(expected_video_ids)


def ndcg_at_k(results: list[dict], expected_video_ids: set[str], k: int) -> float:
    if not expected_video_ids:
        return 0.0
    seen: set[str] = set()
    dcg = 0.0
    for rank, doc in enumerate(results[:k], start=1):
        video_id = doc.get("video_id")
        if video_id in expected_video_ids and video_id not in seen:
            dcg += 1.0 / math.log2(rank + 1)
            seen.add(video_id)
    ideal_hits = min(len(expected_video_ids), k)
    ideal = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return dcg / ideal if ideal else 0.0


def metrics_at_10(results: list[dict], expected_video_ids: set[str]) -> dict[str, float]:
    return {
        "recall10": recall_at_k(results, expected_video_ids, 10),
        "mrr10": reciprocal_rank(results[:10], expected_video_ids),
        "ndcg10": ndcg_at_k(results, expected_video_ids, 10),
    }


def load_golden(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def validate_golden(items: list[dict]) -> None:
    if len(items) < MIN_GOLDEN_QUESTIONS:
        raise ValueError(
            f"Golden set has {len(items)} questions; expected at least {MIN_GOLDEN_QUESTIONS}."
        )
    channels = {item.get("channel") for item in items if item.get("channel")}
    if len(channels) < MIN_GOLDEN_CHANNELS:
        raise ValueError(
            f"Golden set spans {len(channels)} channels; expected {MIN_GOLDEN_CHANNELS}."
        )
    for idx, item in enumerate(items, start=1):
        expected = item.get("expected_video_ids")
        if not item.get("q") or not isinstance(expected, list) or not expected:
            raise ValueError(f"Golden row {idx} must include q and non-empty expected_video_ids.")


def average_metric(rows: list[dict], variant: str, metric: str) -> float:
    return sum(row[variant][metric] for row in rows) / max(1, len(rows))


def main() -> None:
    parser = argparse.ArgumentParser(description="Run MusicRAG retrieval evaluation.")
    parser.add_argument("--golden", type=Path, default=Path("eval/golden.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("eval/report.md"))
    parser.add_argument("--json-report", type=Path, default=Path("eval/report.json"))
    parser.add_argument("--no-enforce-targets", action="store_true")
    args = parser.parse_args()

    items = load_golden(args.golden)
    validate_golden(items)
    rows: list[dict] = []
    for item in items:
        filters = {key: item[key] for key in ("channel", "guest", "topic") if item.get(key)}
        fused = retrieve(item["q"], filters=filters, limit=40)
        ranked = rerank(item["q"], fused, top_k=10)
        expected = set(item["expected_video_ids"])
        baseline = metrics_at_10(fused, expected)
        reranked = metrics_at_10(ranked, expected)
        rows.append(
            {
                "q": item["q"],
                "expected_video_ids": sorted(expected),
                "baseline": baseline,
                "reranked": reranked,
                "top_video_ids": [doc.get("video_id") for doc in ranked[:10]],
            }
        )

    summary = {
        "questions": len(rows),
        "baseline_recall10": average_metric(rows, "baseline", "recall10"),
        "baseline_mrr10": average_metric(rows, "baseline", "mrr10"),
        "baseline_ndcg10": average_metric(rows, "baseline", "ndcg10"),
        "reranked_recall10": average_metric(rows, "reranked", "recall10"),
        "reranked_mrr10": average_metric(rows, "reranked", "mrr10"),
        "reranked_ndcg10": average_metric(rows, "reranked", "ndcg10"),
        "targets": {"recall10": TARGET_RECALL10, "mrr10": TARGET_MRR10},
    }

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        "# MusicRAG Eval Report\n\n"
        f"- Questions: {summary['questions']}\n"
        f"- Baseline Recall@10: {summary['baseline_recall10']:.3f}\n"
        f"- Baseline MRR@10: {summary['baseline_mrr10']:.3f}\n"
        f"- Baseline nDCG@10: {summary['baseline_ndcg10']:.3f}\n"
        f"- Reranked Recall@10: {summary['reranked_recall10']:.3f}\n"
        f"- Reranked MRR@10: {summary['reranked_mrr10']:.3f}\n"
        f"- Reranked nDCG@10: {summary['reranked_ndcg10']:.3f}\n\n"
        "```json\n" + json.dumps(rows, ensure_ascii=False, indent=2) + "\n```\n",
        encoding="utf-8",
    )
    args.json_report.parent.mkdir(parents=True, exist_ok=True)
    args.json_report.write_text(
        json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(summary)
    if not args.no_enforce_targets and (
        summary["reranked_recall10"] < TARGET_RECALL10 or summary["reranked_mrr10"] < TARGET_MRR10
    ):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
