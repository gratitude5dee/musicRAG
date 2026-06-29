from musicrag.eval.run_eval_v2 import average, group_by_intent, render_markdown, summarize

ROWS = [
    {
        "intent": "thematic",
        "baseline": {"recall10": 1.0, "mrr10": 1.0, "ndcg10": 1.0},
        "reranked": {"recall10": 1.0, "mrr10": 0.5, "ndcg10": 0.6},
        "agent": {"recall10": 1.0, "mrr10": 1.0, "ndcg10": 1.0},
    },
    {
        "intent": "entity_lookup",
        "baseline": {"recall10": 0.0, "mrr10": 0.0, "ndcg10": 0.0},
        "reranked": {"recall10": 0.0, "mrr10": 0.0, "ndcg10": 0.0},
        "agent": {"recall10": 1.0, "mrr10": 1.0, "ndcg10": 1.0},
    },
]


def test_group_by_intent():
    groups = group_by_intent(ROWS)
    assert set(groups) == {"thematic", "entity_lookup"}
    assert len(groups["thematic"]) == 1


def test_average_and_summarize():
    assert average(ROWS, "baseline", "recall10") == 0.5
    summary = summarize(ROWS)
    assert summary["questions"] == 2
    assert summary["agent_mrr10"] == 1.0
    assert summary["baseline_recall10"] == 0.5


def test_render_markdown_contains_intent_breakdown():
    per_intent = {intent: summarize(group) for intent, group in group_by_intent(ROWS).items()}
    md = render_markdown(summarize(ROWS), per_intent)
    assert "Eval v2" in md
    assert "entity_lookup" in md
    assert "agent" in md
