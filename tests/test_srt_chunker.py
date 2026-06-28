from musicrag.ingest.srt_chunker import chunks_from_srt_text, parse_srt, timestamped_stream_from_srt


ROLLING_SAMPLE = """1
00:00:03,990 --> 00:00:04,000
this is is a good segue um how do you

2
00:00:04,000 --> 00:00:07,549
this is is a good segue um how do you identify a great

3
00:00:10,110 --> 00:00:10,120
artist oh there's so many things well

4
00:00:10,120 --> 00:00:12,310
artist oh there's so many things well let's say this like I could simplify
"""


def test_parse_srt_reads_cues():
    cues = parse_srt(ROLLING_SAMPLE)
    assert len(cues) == 4
    assert cues[0].start == 3.99
    assert cues[1].end == 7.549


def test_timestamped_stream_collapses_rolling_caption_overlap():
    stream = timestamped_stream_from_srt(ROLLING_SAMPLE)
    text = " ".join(token.text for token in stream)
    assert text.count("this is is a good segue") == 1
    assert "identify a great artist" in text
    assert stream[0].start == 3.99
    assert stream[-1].start == 10.12


def test_chunks_have_monotonic_timestamps_and_text():
    chunks = chunks_from_srt_text(ROLLING_SAMPLE, target_tokens=10, overlap_tokens=2)
    assert chunks
    starts = [chunk.start_sec for chunk in chunks if chunk.start_sec is not None]
    assert starts == sorted(starts)
    assert all(chunk.text for chunk in chunks)

