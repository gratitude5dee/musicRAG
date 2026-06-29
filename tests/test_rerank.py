from musicrag.query.rerank import _normalize, format_for_rerank, fuse_and_aggregate


def test_normalize_constant_and_empty():
    assert _normalize([]) == []
    assert _normalize([5, 5, 5]) == [1.0, 1.0, 1.0]
    out = _normalize([0.0, 5.0, 10.0])
    assert out[0] == 0.0 and out[-1] == 1.0


def test_format_for_rerank_includes_metadata():
    text = format_for_rerank(
        {"title": "Hit Record", "guests": ["D'Mile"], "channel": "Managers Playbook", "text": "we wrote it"}
    )
    assert "Hit Record" in text
    assert "D'Mile" in text
    assert "Managers Playbook" in text
    assert "we wrote it" in text


def test_episode_aware_promotes_corroborated_episode():
    # WRONG has the single highest cross-encoder score but no support; RIGHT is
    # corroborated by three strong chunks. Naive sort keeps WRONG #1; the
    # episode-aware two-level ranking must lift RIGHT to #1 (the MRR fix).
    docs = [
        {"chunk_uid": "w0", "video_id": "WRONG", "rerank_score": 1.00, "rrf_score": 0.10},
        {"chunk_uid": "r0", "video_id": "RIGHT", "rerank_score": 0.70, "rrf_score": 0.95},
        {"chunk_uid": "r1", "video_id": "RIGHT", "rerank_score": 0.65, "rrf_score": 0.90},
        {"chunk_uid": "r2", "video_id": "RIGHT", "rerank_score": 0.60, "rrf_score": 0.85},
    ]
    naive = fuse_and_aggregate(docs, episode_aware=False)
    assert naive[0]["video_id"] == "WRONG"

    aware = fuse_and_aggregate(docs, episode_aware=True)
    assert aware[0]["video_id"] == "RIGHT"


def test_single_strong_uncorroborated_chunk_still_wins():
    # A genuinely best, well-supported single episode must not be demoted just
    # because a rival episode has more (but weak) chunks.
    docs = [
        {"chunk_uid": "a", "video_id": "A", "rerank_score": 1.0, "rrf_score": 1.0},
        {"chunk_uid": "b", "video_id": "B", "rerank_score": 0.2, "rrf_score": 0.2},
        {"chunk_uid": "c", "video_id": "B", "rerank_score": 0.15, "rrf_score": 0.1},
    ]
    aware = fuse_and_aggregate(docs)
    assert aware[0]["video_id"] == "A"


def test_empty_input():
    assert fuse_and_aggregate([]) == []
