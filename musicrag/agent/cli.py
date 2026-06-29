from __future__ import annotations

import argparse
import json

from musicrag.agent.pipeline import default_tools, run_agent
from musicrag.query.answer import source_payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Ask MusicRAG via the agentic router.")
    parser.add_argument("question")
    parser.add_argument("--no-answer", action="store_true", help="Only route + retrieve; skip generation.")
    parser.add_argument("--trace", action="store_true", help="Include the node-by-node trace.")
    parser.add_argument("--rewrites", type=int, default=1, help="Max self-correction loops.")
    parser.add_argument("--top-k", type=int, default=8)
    args = parser.parse_args()

    tools = default_tools(generate=not args.no_answer, max_rewrites=args.rewrites, top_k=args.top_k)
    state = run_agent(args.question, tools)
    plan = state.plan
    grade = state.grade

    out: dict = {
        "query": state.query,
        "intent": plan.intent.value if plan else None,
        "rationale": plan.rationale if plan else None,
        "guests": plan.guests if plan else [],
        "channels": plan.channels if plan else [],
        "topics": plan.topics if plan else [],
        "grade": (
            {"sufficient": grade.sufficient, "confidence": grade.confidence, "reason": grade.reason}
            if grade
            else None
        ),
    }
    if state.answer:
        out["answer"] = state.answer["answer"]
        out["sources"] = state.answer["sources"]
    else:
        out["sources"] = [source_payload(doc) for doc in state.docs]
    if args.trace:
        out["trace"] = state.trace

    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
