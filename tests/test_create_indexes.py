from musicrag.ingest.create_indexes import TEXT_INDEX_DEFINITION, VECTOR_INDEX_DEFINITION


def test_vector_index_matches_goal_shape():
    vector_field = VECTOR_INDEX_DEFINITION["fields"][0]
    assert vector_field["path"] == "embedding"
    assert vector_field["numDimensions"] == 1024
    assert vector_field["similarity"] == "dotProduct"
    filter_paths = {field["path"] for field in VECTOR_INDEX_DEFINITION["fields"][1:]}
    assert {"channel", "guests", "topics", "video_id", "caption_type", "upload_ts"} <= filter_paths


def test_text_index_is_explicit_mapping():
    assert TEXT_INDEX_DEFINITION["mappings"]["dynamic"] is False
    assert TEXT_INDEX_DEFINITION["mappings"]["fields"]["text"]["analyzer"] == "lucene.english"

