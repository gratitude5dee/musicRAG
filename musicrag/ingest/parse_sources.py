from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from pymongo import ReplaceOne

from musicrag.common import compact_spaces, parse_iso_date_to_epoch, slugify, unique_clean
from musicrag.config import Settings, get_db, settings

TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "a&r": ("a&r", "anr", "artist discovery", "scout", "signing"),
    "artist management": ("manager", "management", "artist manager", "manage artists"),
    "artist development": ("artist development", "develop artist", "career development"),
    "branding": ("brand", "branding", "identity", "image"),
    "content strategy": ("content", "tiktok", "short form", "social media", "creator"),
    "deal structure": ("deal", "contract", "advance", "term", "label deal"),
    "distribution": ("distribution", "distro", "distributor"),
    "engineering": ("engineer", "mix", "master", "dolby", "atmos", "studio"),
    "fanbase": ("fan", "community", "audience", "superfan"),
    "independent artists": ("independent", "indie", "without a label", "diy"),
    "label strategy": ("label", "major label", "record label"),
    "marketing": ("marketing", "campaign", "rollout", "promotion", "promo"),
    "music business": ("music business", "industry", "business model"),
    "publishing": ("publishing", "publisher", "songwriter royalties", "composition"),
    "royalties": ("royalty", "royalties", "neighboring rights", "performance rights"),
    "songwriting": ("songwriter", "songwriting", "writing camp", "write songs"),
    "sync": ("sync", "licensing", "film", "tv placement"),
    "touring": ("tour", "touring", "live show", "festival"),
    "production": ("producer", "production", "beat", "sample", "record producer"),
}

BOILERPLATE_TAGS = {
    "music",
    "podcast",
    "music podcast",
    "interview",
    "youtube",
    "artist",
    "artists",
    "music industry",
}


@dataclass(frozen=True)
class SourceRow:
    channel: str
    video_id: str
    title: str
    upload_date: str | None
    duration_seconds: float | None
    caption_type: str
    has_transcript: bool
    word_count: int
    folder: str


def bool_from_csv(value: str) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def read_index(transcripts_root: Path) -> list[SourceRow]:
    index_path = transcripts_root / "_index.csv"
    if not index_path.exists():
        raise FileNotFoundError(f"Missing transcript index: {index_path}")
    rows: list[SourceRow] = []
    with index_path.open("r", encoding="utf-8-sig", newline="") as handle:
        for raw in csv.DictReader(handle):
            rows.append(
                SourceRow(
                    channel=raw["channel"],
                    video_id=raw["video_id"],
                    title=raw["title"],
                    upload_date=raw.get("upload_date") or None,
                    duration_seconds=float(raw["duration_seconds"])
                    if raw.get("duration_seconds")
                    else None,
                    caption_type=raw.get("caption_type") or "unknown",
                    has_transcript=bool_from_csv(raw.get("has_transcript", "")),
                    word_count=int(float(raw.get("word_count") or 0)),
                    folder=raw["folder"],
                )
            )
    return rows


def load_metadata(transcripts_root: Path, row: SourceRow) -> dict[str, Any]:
    path = transcripts_root / row.channel / row.folder / "metadata.json"
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_chapters(description: str | None) -> list[dict[str, Any]]:
    if not description:
        return []
    chapters: list[dict[str, Any]] = []
    pattern = re.compile(r"(?m)^\s*(?P<time>(?:\d{1,2}:)?\d{1,2}:\d{2})\s+[-–—:]?\s*(?P<label>.+)$")
    for match in pattern.finditer(description):
        parts = [int(p) for p in match.group("time").split(":")]
        if len(parts) == 2:
            seconds = parts[0] * 60 + parts[1]
        else:
            seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
        label = compact_spaces(match.group("label"))
        if label:
            chapters.append({"t": seconds, "label": label})
    return chapters


def title_name_candidates(title: str) -> list[str]:
    cleaned = compact_spaces(re.sub(r"(?i)^ep\.?\s*\d+\s*[:\-–—]\s*", "", title))
    candidates: list[str] = []

    paren_names = re.findall(r"\(([^()]{3,80})\)", cleaned)
    candidates.extend(paren_names)

    split_patterns = [r"\s+\|\s+", r"\s+[-–—]\s+", r"\s+w/\s+", r"\s+with\s+"]
    for pattern in split_patterns:
        parts = re.split(pattern, cleaned, maxsplit=1, flags=re.I)
        if len(parts) > 1:
            candidates.append(parts[0])
            if pattern.endswith("with\\s+"):
                candidates.append(parts[1].split("|")[0].split("-")[0])

    if not candidates and len(cleaned.split()) <= 5:
        candidates.append(cleaned)

    return [c for c in candidates if looks_like_person_or_group(c)]


def looks_like_person_or_group(value: str) -> bool:
    value = compact_spaces(value)
    if not value or len(value) < 3:
        return False
    lower = value.lower()
    if any(word in lower for word in ("how ", "why ", "what ", "inside ", "the story")):
        return False
    tokens = [t for t in re.split(r"\s+", value) if t]
    if len(tokens) > 6:
        return False
    capitalized = sum(1 for t in tokens if t[:1].isupper() or t.isupper())
    return capitalized >= max(1, len(tokens) // 2)


def extract_guests(metadata: dict[str, Any], row: SourceRow) -> list[str]:
    candidates: list[str] = title_name_candidates(metadata.get("title") or row.title)
    tags = metadata.get("tags") or []
    if isinstance(tags, list):
        candidates.extend(tag for tag in tags if looks_like_person_or_group(str(tag)))
    return unique_clean(candidates)


def extract_topics(metadata: dict[str, Any], row: SourceRow, chapters: list[dict[str, Any]]) -> list[str]:
    haystack_parts = [row.title, metadata.get("title") or "", metadata.get("description") or ""]
    haystack_parts.extend(chapter["label"] for chapter in chapters)
    haystack = " ".join(haystack_parts).lower()
    topics: list[str] = []
    for topic, keywords in TOPIC_KEYWORDS.items():
        if any(keyword in haystack for keyword in keywords):
            topics.append(topic)

    tags = metadata.get("tags") or []
    if isinstance(tags, list):
        for tag in tags:
            tag_text = compact_spaces(str(tag))
            if not tag_text or tag_text.lower() in BOILERPLATE_TAGS:
                continue
            if len(tag_text.split()) <= 4 and not looks_like_person_or_group(tag_text):
                topics.append(tag_text.lower())

    return unique_clean(topics)[:20]


def episode_document(transcripts_root: Path, row: SourceRow, schema_version: int) -> dict[str, Any]:
    metadata = load_metadata(transcripts_root, row)
    chapters = parse_chapters(metadata.get("description"))
    upload_date = metadata.get("upload_date") or row.upload_date
    guests = extract_guests(metadata, row)
    topics = extract_topics(metadata, row, chapters)
    source_folder = str(Path(row.channel) / row.folder)
    return {
        "video_id": row.video_id,
        "channel": row.channel,
        "channel_id": metadata.get("channel_id"),
        "channel_url": metadata.get("channel_url"),
        "title": metadata.get("title") or row.title,
        "video_url": metadata.get("video_url") or f"https://www.youtube.com/watch?v={row.video_id}",
        "thumbnail": metadata.get("thumbnail"),
        "upload_date": upload_date,
        "upload_ts": parse_iso_date_to_epoch(upload_date),
        "duration_seconds": metadata.get("duration_seconds") or row.duration_seconds,
        "view_count": metadata.get("view_count"),
        "like_count": metadata.get("like_count"),
        "language": metadata.get("language"),
        "caption_type": metadata.get("caption_type") or row.caption_type,
        "has_transcript": row.has_transcript,
        "word_count": metadata.get("transcript_word_count") or row.word_count,
        "chunk_count": 0,
        "guests": guests,
        "topics": topics,
        "chapters": chapters,
        "source_folder": source_folder,
        "schema_version": schema_version,
    }


def channel_documents(episodes: Iterable[dict[str, Any]], schema_version: int) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for episode in episodes:
        channel = episode["channel"]
        doc = grouped.setdefault(
            channel,
            {
                "channel": channel,
                "channel_id": episode.get("channel_id"),
                "channel_url": episode.get("channel_url"),
                "episode_count": 0,
                "transcribed_count": 0,
                "schema_version": schema_version,
            },
        )
        doc["episode_count"] += 1
        doc["transcribed_count"] += int(bool(episode.get("has_transcript")))
        doc["channel_id"] = doc.get("channel_id") or episode.get("channel_id")
        doc["channel_url"] = doc.get("channel_url") or episode.get("channel_url")
    return list(grouped.values())


def entity_documents(episodes: Iterable[dict[str, Any]], schema_version: int) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for episode in episodes:
        for entity_type, values in (("guest", episode.get("guests") or []), ("topic", episode.get("topics") or [])):
            for name in values:
                key = (entity_type, slugify(name))
                doc = grouped.setdefault(
                    key,
                    {
                        "name": name,
                        "type": entity_type,
                        "slug": slugify(name),
                        "episode_ids": [],
                        "episode_count": 0,
                        "channels": [],
                        "schema_version": schema_version,
                    },
                )
                doc["episode_ids"].append(episode["video_id"])
                doc["channels"].append(episode["channel"])

    for doc in grouped.values():
        doc["episode_ids"] = sorted(set(doc["episode_ids"]))
        doc["channels"] = sorted(set(doc["channels"]))
        doc["episode_count"] = len(doc["episode_ids"])
    return list(grouped.values())


def build_catalog(cfg: Settings) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    rows = read_index(cfg.transcripts_root)
    episodes = [episode_document(cfg.transcripts_root, row, cfg.schema_version) for row in rows]
    return episodes, channel_documents(episodes, cfg.schema_version), entity_documents(episodes, cfg.schema_version)


def upsert_catalog(episodes: list[dict[str, Any]], channels: list[dict[str, Any]], entities: list[dict[str, Any]]) -> None:
    db = get_db()
    if episodes:
        db.episodes.bulk_write(
            [ReplaceOne({"video_id": doc["video_id"]}, doc, upsert=True) for doc in episodes],
            ordered=False,
        )
    if channels:
        db.channels.bulk_write(
            [ReplaceOne({"channel": doc["channel"]}, doc, upsert=True) for doc in channels],
            ordered=False,
        )
    if entities:
        db.entities.bulk_write(
            [ReplaceOne({"type": doc["type"], "slug": doc["slug"]}, doc, upsert=True) for doc in entities],
            ordered=False,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse transcript metadata into MongoDB catalog records.")
    parser.add_argument("--dry-run", action="store_true", help="Build records and print counts without writing.")
    args = parser.parse_args()

    cfg = settings()
    episodes, channels, entities = build_catalog(cfg)
    if args.dry_run:
        print({"episodes": len(episodes), "channels": len(channels), "entities": len(entities)})
        for sample in episodes[:3]:
            print({"video_id": sample["video_id"], "guests": sample["guests"], "topics": sample["topics"]})
        return
    upsert_catalog(episodes, channels, entities)
    print(f"Upserted {len(episodes)} episodes, {len(channels)} channels, {len(entities)} entities.")


if __name__ == "__main__":
    main()

