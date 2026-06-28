from musicrag.ingest.parse_sources import SourceRow, extract_guests, extract_topics, parse_chapters


def sample_row(title: str) -> SourceRow:
    return SourceRow(
        channel="Managers Playbook",
        video_id="abc123",
        title=title,
        upload_date="2024-06-04",
        duration_seconds=120.0,
        caption_type="auto",
        has_transcript=True,
        word_count=1000,
        folder="Example [abc123]",
    )


def test_parse_chapters_extracts_timestamps():
    chapters = parse_chapters("00:00 Intro\n10:05 Publishing rights\n1:02:03 Touring")
    assert chapters == [
        {"t": 0, "label": "Intro"},
        {"t": 605, "label": "Publishing rights"},
        {"t": 3723, "label": "Touring"},
    ]


def test_extract_guests_from_title_patterns():
    row = sample_row("Ep. 228: Hit-Boy | Success, Betrayal, & The Stories Behind Hip-Hop")
    guests = extract_guests({"title": row.title, "tags": None}, row)
    assert "Hit-Boy" in guests


def test_extract_topics_from_metadata_text():
    row = sample_row("KOSIGN Explains Music Publishing Royalties")
    topics = extract_topics({"title": row.title, "description": "Publishing and songwriter royalties", "tags": None}, row, [])
    assert "publishing" in topics
    assert "royalties" in topics

