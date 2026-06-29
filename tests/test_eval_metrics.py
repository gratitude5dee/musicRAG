import pytest

from musicrag.eval.run_eval import MIN_GOLDEN_CHANNELS, MIN_GOLDEN_QUESTIONS, metrics_at_10, validate_golden


def test_metrics_at_10_dedupes_relevant_episode_hits():
    results = [
        {"video_id": "wrong"},
        {"video_id": "expected-a"},
        {"video_id": "expected-a"},
        {"video_id": "expected-b"},
    ]
    metrics = metrics_at_10(results, {"expected-a", "expected-b"})
    assert metrics["recall10"] == 1.0
    assert metrics["mrr10"] == 0.5
    assert round(metrics["ndcg10"], 3) == 0.651


def test_validate_golden_requires_minimum_question_count():
    with pytest.raises(ValueError, match="expected at least"):
        validate_golden(
            [
                {
                    "q": "What is the question?",
                    "expected_video_ids": ["abc"],
                    "channel": "One More Time Podcast",
                }
            ]
        )


def test_validate_golden_accepts_required_shape():
    items = []
    for index in range(MIN_GOLDEN_QUESTIONS):
        items.append(
            {
                "q": f"Question {index}?",
                "expected_video_ids": [f"video-{index}"],
                "channel": f"Channel {index % MIN_GOLDEN_CHANNELS}",
            }
        )
    validate_golden(items)
