import re

from musicrag.agent.tools import (
    episode_chunks,
    find_episodes_by_guest,
    guest_episode_query,
    load_vocabulary,
    related_query,
    topic_episode_query,
)


# --- minimal in-memory Mongo stand-in (supports the few operators tools use) ----


def _matches(doc, query):
    for key, cond in query.items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
            continue
        value = doc.get(key)
        if isinstance(cond, dict):
            for op, arg in cond.items():
                if op == "$in":
                    haystack = value if isinstance(value, list) else [value]
                    if not (set(haystack) & set(arg)):
                        return False
                elif op == "$ne":
                    if value == arg:
                        return False
                elif op == "$regex":
                    flags = re.I if "i" in cond.get("$options", "") else 0
                    if not (isinstance(value, str) and re.search(arg, value, flags)):
                        return False
                elif op == "$eq":
                    if isinstance(value, list):
                        if arg not in value:
                            return False
                    elif value != arg:
                        return False
                elif op == "$options":
                    continue
        else:
            if isinstance(value, list):
                if cond not in value:
                    return False
            elif value != cond:
                return False
    return True


class FakeCursor(list):
    def sort(self, key, direction=1):
        list.sort(self, key=lambda d: (d.get(key) is None, d.get(key)), reverse=direction == -1)
        return self

    def limit(self, n):
        return FakeCursor(self[:n])


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None):
        return FakeCursor([d for d in self.docs if _matches(d, query or {})])

    def find_one(self, query=None, projection=None):
        for d in self.docs:
            if _matches(d, query or {}):
                return d
        return None


class FakeDB:
    def __init__(self, episodes=None, entities=None, channels=None, chunks=None):
        self.episodes = FakeCollection(episodes or [])
        self.entities = FakeCollection(entities or [])
        self.channels = FakeCollection(channels or [])
        self.chunks = FakeCollection(chunks or [])


# --- pure query builders ---------------------------------------------------------


def test_guest_episode_query_shape():
    q = guest_episode_query("Bernard MacMahon")
    assert q["$or"][0] == {"guests": "Bernard MacMahon"}
    assert q["$or"][1]["title"]["$regex"]
    assert q["$or"][1]["title"]["$options"] == "i"


def test_topic_and_related_query_shape():
    assert topic_episode_query("branding") == {"topics": "branding"}
    rq = related_query("V1", ["G"], ["T"])
    assert rq["video_id"] == {"$ne": "V1"}
    assert {"guests": {"$in": ["G"]}} in rq["$or"]


# --- DB-backed tools -------------------------------------------------------------


def test_load_vocabulary_splits_entities_and_channels():
    db = FakeDB(
        entities=[
            {"name": "Jimmy Iovine", "type": "guest"},
            {"name": "publishing", "type": "topic"},
        ],
        channels=[{"channel": "Managers Playbook"}],
    )
    vocab = load_vocabulary(db)
    assert vocab.guests["jimmy iovine"] == "Jimmy Iovine"
    assert vocab.topics["publishing"] == "publishing"
    assert vocab.channels["managers playbook"] == "Managers Playbook"


def test_find_episodes_by_guest_uses_entity_backref():
    db = FakeDB(
        entities=[{"type": "guest", "slug": "jimmy-iovine", "episode_ids": ["niqahsc9jfo"]}],
        episodes=[
            {"video_id": "niqahsc9jfo", "channel": "IDEA GENERATION", "title": "Jimmy Iovine"},
            {"video_id": "other", "channel": "X", "title": "Someone else"},
        ],
    )
    eps = find_episodes_by_guest("Jimmy Iovine", db=db)
    assert [e["video_id"] for e in eps] == ["niqahsc9jfo"]


def test_find_episodes_by_guest_title_fallback_when_extraction_missed():
    # No entity row (guest extraction missed it) but the name is in the title.
    db = FakeDB(
        episodes=[
            {"video_id": "Te50Pm9oQsY", "channel": "Rick Rubin - Tetragrammaton", "title": "Bernard MacMahon", "guests": []},
            {"video_id": "zzz", "channel": "X", "title": "Unrelated", "guests": []},
        ],
    )
    eps = find_episodes_by_guest("Bernard MacMahon", db=db)
    assert [e["video_id"] for e in eps] == ["Te50Pm9oQsY"]


def test_episode_chunks_sorted_by_index():
    db = FakeDB(
        chunks=[
            {"chunk_uid": "v:2", "video_id": "v", "chunk_index": 2, "text": "c"},
            {"chunk_uid": "v:0", "video_id": "v", "chunk_index": 0, "text": "a"},
            {"chunk_uid": "v:1", "video_id": "v", "chunk_index": 1, "text": "b"},
        ]
    )
    chunks = episode_chunks("v", db=db)
    assert [c["chunk_index"] for c in chunks] == [0, 1, 2]
