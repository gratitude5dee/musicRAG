from musicrag.query.embeddings import select_query_embedding


def test_context4_uses_contextualized_path():
    model, contextualized = select_query_embedding("voyage-context-4", "voyage-4-large")
    assert model == "voyage-context-4"
    assert contextualized is True


def test_non_context_model_uses_standard_path():
    model, contextualized = select_query_embedding("voyage-4-large", "voyage-4-large")
    assert model == "voyage-4-large"
    assert contextualized is False


def test_empty_model_falls_back():
    model, contextualized = select_query_embedding("", "voyage-4-large")
    assert model == "voyage-4-large"
    assert contextualized is False
