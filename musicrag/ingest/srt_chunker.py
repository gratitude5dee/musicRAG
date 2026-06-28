from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from musicrag.common import compact_spaces

TOKEN_RE = re.compile(r"\w+(?:['’]\w+)?|[^\w\s]", re.UNICODE)
SRT_TIME_RE = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(?P<end>\d{2}:\d{2}:\d{2},\d{3})"
)


@dataclass(frozen=True)
class Cue:
    index: int
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TimedToken:
    text: str
    start: float | None
    end: float | None
    cue_index: int


@dataclass(frozen=True)
class Chunk:
    chunk_index: int
    text: str
    start_sec: float | None
    end_sec: float | None
    token_count: int
    word_count: int


def parse_srt_timestamp(value: str) -> float:
    hours, minutes, rest = value.split(":")
    seconds, millis = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_srt(text: str) -> list[Cue]:
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: list[Cue] = []
    for fallback_index, block in enumerate(blocks, start=1):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines:
            continue
        time_line_idx = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if time_line_idx is None:
            continue
        match = SRT_TIME_RE.search(lines[time_line_idx])
        if not match:
            continue
        idx = fallback_index
        if time_line_idx > 0 and lines[0].isdigit():
            idx = int(lines[0])
        cue_text = compact_spaces(" ".join(lines[time_line_idx + 1 :]))
        if not cue_text:
            continue
        cues.append(
            Cue(
                index=idx,
                start=parse_srt_timestamp(match.group("start")),
                end=parse_srt_timestamp(match.group("end")),
                text=cue_text,
            )
        )
    return cues


def tokenize(text: str) -> list[str]:
    return TOKEN_RE.findall(text)


def normalize_token(token: str) -> str:
    return token.lower().strip()


def longest_tail_prefix_overlap(existing: list[str], incoming: list[str], max_scan: int = 120) -> int:
    if not existing or not incoming:
        return 0
    max_len = min(len(existing), len(incoming), max_scan)
    for size in range(max_len, 0, -1):
        if existing[-size:] == incoming[:size]:
            return size
    return 0


def timestamped_stream_from_srt(srt_text: str) -> list[TimedToken]:
    stream: list[TimedToken] = []
    normalized_stream: list[str] = []
    for cue in parse_srt(srt_text):
        cue_tokens = tokenize(cue.text)
        normalized_cue = [normalize_token(token) for token in cue_tokens]
        overlap = longest_tail_prefix_overlap(normalized_stream, normalized_cue)
        new_tokens = cue_tokens[overlap:]
        new_norm = normalized_cue[overlap:]
        if not new_tokens:
            continue
        normalized_stream.extend(new_norm)
        stream.extend(TimedToken(token, cue.start, cue.end, cue.index) for token in new_tokens)
    return stream


def timestamped_stream_from_text(text: str) -> list[TimedToken]:
    return [TimedToken(token, None, None, idx) for idx, token in enumerate(tokenize(text))]


def detokenize(tokens: Iterable[str]) -> str:
    out = ""
    for token in tokens:
        if not out:
            out = token
        elif re.match(r"^[,.;:!?%)\]}]$", token):
            out += token
        elif token in {"'", "’"}:
            out += token
        elif out.endswith(("(", "[", "{", "$")):
            out += token
        else:
            out += " " + token
    return compact_spaces(out)


def choose_window_end(stream: list[TimedToken], start: int, target: int, min_size: int) -> int:
    n = len(stream)
    rough_end = min(n, start + target)
    if rough_end == n:
        return n
    lower = min(n, start + min_size)
    best = rough_end
    for idx in range(rough_end - 1, lower - 1, -1):
        if stream[idx].text in {".", "!", "?", ";"}:
            best = idx + 1
            break
    while best < n and stream[best - 1].cue_index == stream[best].cue_index:
        best += 1
    return max(best, start + 1)


def move_start_to_cue_boundary(stream: list[TimedToken], start: int) -> int:
    while start > 0 and stream[start - 1].cue_index == stream[start].cue_index:
        start -= 1
    return start


def chunks_from_stream(
    stream: list[TimedToken],
    target_tokens: int = 500,
    overlap_tokens: int = 75,
) -> list[Chunk]:
    if not stream:
        return []
    if len(stream) <= target_tokens:
        return [chunk_from_slice(0, stream)]

    chunks: list[Chunk] = []
    start = 0
    min_size = max(50, math.floor(target_tokens * 0.65))
    while start < len(stream):
        end = choose_window_end(stream, start, target_tokens, min_size)
        chunks.append(chunk_from_slice(len(chunks), stream[start:end]))
        if end >= len(stream):
            break
        next_start = max(start + 1, end - overlap_tokens)
        adjusted_start = move_start_to_cue_boundary(stream, next_start)
        start = adjusted_start if adjusted_start > start else next_start
    return chunks


def chunk_from_slice(chunk_index: int, sliced: list[TimedToken]) -> Chunk:
    text = detokenize(token.text for token in sliced)
    starts = [token.start for token in sliced if token.start is not None]
    ends = [token.end for token in sliced if token.end is not None]
    return Chunk(
        chunk_index=chunk_index,
        text=text,
        start_sec=starts[0] if starts else None,
        end_sec=ends[-1] if ends else None,
        token_count=len(sliced),
        word_count=len(re.findall(r"\b\w+\b", text)),
    )


def chunks_from_srt_text(srt_text: str, target_tokens: int = 500, overlap_tokens: int = 75) -> list[Chunk]:
    return chunks_from_stream(timestamped_stream_from_srt(srt_text), target_tokens, overlap_tokens)


def chunks_from_plain_text(text: str, target_tokens: int = 500, overlap_tokens: int = 75) -> list[Chunk]:
    return chunks_from_stream(timestamped_stream_from_text(text), target_tokens, overlap_tokens)


def chunks_from_episode_files(
    episode_dir: Path,
    target_tokens: int = 500,
    overlap_tokens: int = 75,
) -> tuple[list[Chunk], str | None]:
    srt_path = episode_dir / "transcript.srt"
    txt_path = episode_dir / "transcript.txt"
    if srt_path.exists():
        return chunks_from_srt_text(srt_path.read_text(encoding="utf-8"), target_tokens, overlap_tokens), str(srt_path)
    if txt_path.exists():
        return chunks_from_plain_text(txt_path.read_text(encoding="utf-8"), target_tokens, overlap_tokens), str(txt_path)
    return [], None
