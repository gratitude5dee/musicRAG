from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from musicrag.eval.run_eval import load_golden, metrics_at_10, validate_golden

VARIANTS = ("baseline", "reranked", "agent")
METRICS = ("recall10", "mrr10", "ndcg10")


# --- pure helpers (offline-testable) ---------------------------------------------


def group_by_intent(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[row.get("intent", "unknown")].append(row)
    return dict(groups)


def average(rows: list[dict[str, Any]], variant: str, metric: str) -> float:
    values = [row[variant][metric] for row in rows if variant in row and metric in row[variant]]
    return sum(values) / len(values) if values else 0.0


def summarize(
    rows: list[dict[str, Any]],
    variants: tuple[str, ...] = VARIANTS,
    metrics: tuple[str, ...] = METRICS,
) -> dict[str, Any]:
    summary: dict[str, Any] = {"questions": len(rows)}
    for variant in variants:
        for metric in metrics:
            summary[f"{variant}_{metric}"] = round(average(rows, variant, metric), 4)
    return summary


def render_markdown(summary: dict[str, Any], per_intent: dict[str, dict[str, Any]]) -> str:
    lines = ["# MusicRAG Eval v2 (baseline / reranked / agent)", ""]
    lines.append(f"- Questions: {summary['questions']}")
    for variant in VARIANTS:
        lines.append(
            f"- {variant.capitalize()}: "
            f"Recall@10 {summary[f'{variant}_recall10']:.3f} · "
            f"MRR@10 {summary[f'{variant}_mrr10']:.3f} · "
            f"nDCG@10 {summary[f'{variant}_ndcg10']:.3f}"
        )
    lines += ["", "## By intent", "", "| Intent | n | Variant | Recall@10 | MRR@10 | nDCG@10 |", "|---|---|---|---|---|---|"]
    for intent, isum in sorted(per_intent.items()):
        for variant in VARIANTS:
            lines.append(
                f"| {intent} | {isum['questions']} | {variant} | "
                f"{isum[f'{variant}_recall10']:.3f} | "
                f"{isum[f'{variant}_mrr10']:.3f} | "
                f"{isum[f'{variant}_ndcg10']:.3f} |"
            )
    return "\n".join(lines) + "\n"


# --- live runner (needs Mongo + Voyage) ------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Three-way MusicRAG eval: baseline vs episode-aware rerank vs agent."
    )
    parser.add_argument("--golden", type=Path, default=Path("eval/golden.jsonl"))
    parser.add_argument("--report", type=Path, default=Path("eval/report_v2.md"))
    parser.add_argument("--json-report", type=Path, default=Path("eval/report_v2.json"))
    parser.add_argument("--rewrites", type=int, default=1)
    args = parser.parse_args()

    # Imported here so the pure helpers above can be unit-tested without secrets.
    from dataclasses import replace as _replace

    from musicrag.agent.intent import classify_intent
    from musicrag.agent.pipeline import default_tools, run_agent
    from musicrag.query.rerank import rerank
    from musicrag.query.retrieve import retrieve

    items = load_golden(args.golden)
    validate_golden(items)

    tools = default_tools(generate=False, max_rewrites=args.rewrites, top_k=10)
    rows: list[dict[str, Any]] = []
    for item in items:
        query = item["q"]
        expected = set(item["expected_video_ids"])
        filters = {key: item[key] for key in ("channel", "guest", "topic") if item.get(key)}

        plan = classify_intent(query, tools.vocab)
        fused = retrieve(query, filters=filters, limit=40)
        reranked = rerank(query, fused, top_k=10)
        agent_state = run_agent(query, _replace(tools, top_k=10))

        rows.append(
            {
                "q": query,
                "intent": plan.intent.value,
                "agent_intent": agent_state.plan.intent.value if agent_state.plan else None,
                "expected_video_ids": sorted(expected),
                "baseline": metrics_at_10(fused, expected),
                "reranked": metrics_at_10(reranked, expected),
                "agent": metrics_at_10(agent_state.docs, expected),
                "agent_top_video_ids": [d.get("video_id") for d in agent_state.docs[:10]],
            }
        )

    summary = summarize(rows)
    per_intent = {intent: summarize(group) for intent, group in group_by_intent(rows).items()}

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(render_markdown(summary, per_intent), encoding="utf-8")
    args.json_report.write_text(
        json.dumps({"summary": summary, "per_intent": per_intent, "rows": rows}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"summary": summary, "per_intent": per_intent}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
