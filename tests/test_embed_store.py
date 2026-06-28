from musicrag.ingest.embed_store import group_by_token_budget, needs_embedding, validate_embeddings


def test_group_by_token_budget_keeps_order():
    records = [
        {"chunk_uid": "a", "text": "one", "token_count": 10},
        {"chunk_uid": "b", "text": "two", "token_count": 10},
        {"chunk_uid": "c", "text": "three", "token_count": 10},
    ]
    groups = group_by_token_budget(records, 20)
    assert [[record["chunk_uid"] for record in group] for group in groups] == [["a", "b"], ["c"]]


def test_needs_embedding_skips_matching_state():
    record = {"content_hash": "hash"}
    existing = {"content_hash": "hash", "embed_dims": 1024, "embedding": [0.0] * 1024}
    assert needs_embedding(record, existing, 1024) is False


def test_validate_embeddings_rejects_wrong_dims():
    try:
        validate_embeddings([[0.0, 1.0]], 1024)
    except ValueError as exc:
        assert "expected 1024" in str(exc)
    else:
        raise AssertionError("expected ValueError")

