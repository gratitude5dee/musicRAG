from __future__ import annotations

import argparse

from musicrag.query.answer import generate_answer, to_json
from musicrag.query.rerank import rerank
from musicrag.query.retrieve import retrieve


def main() -> None:
    parser = argparse.ArgumentParser(description="Ask MusicRAG from the terminal.")
    parser.add_argument("question")
    parser.add_argument("--channel")
    parser.add_argument("--guest")
    parser.add_argument("--topic")
    parser.add_argument("--no-answer", action="store_true", help="Only print retrieved sources.")
    args = parser.parse_args()

    filters = {"channel": args.channel, "guest": args.guest, "topic": args.topic}
    docs = retrieve(args.question, filters={k: v for k, v in filters.items() if v}, limit=40)
    top_docs = rerank(args.question, docs, top_k=8)
    if args.no_answer:
        print(to_json({"sources": top_docs}))
        return
    print(to_json(generate_answer(args.question, top_docs)))


if __name__ == "__main__":
    main()

