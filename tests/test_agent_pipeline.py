import re

from musicrag.agent.intent import Intent, Vocabulary
from musicrag.agent.pipeline import AgentTools, best_per_video, diversify_by_video, run_agent
from musicrag.query.rerank import fuse_and_aggregate


# --- in-memory Mongo stand-in ----------------------------------------------------


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


def fake_rerank(query, docs, k):
    scored = [{**d, "rerank_score": float(d.get("rel", 0.5))} for d in docs]
    return fuse_and_aggregate(scored)[:k]


def make_retrieve(docs):
    def _retrieve(query, filters, limit):
        return [dict(d) for d in docs]

    return _retrieve


def make_tools(db, retrieve_docs, **kw):
    return AgentTools(
        vocab=kw.pop("vocab", Vocabulary()),
        retrieve=make_retrieve(retrieve_docs),
        rerank=fake_rerank,
        db=db,
        **kw,
    )


# --- the headline fix: entity route rescues a known-item the blind search missed --


def test_entity_route_recovers_episode_absent_from_chunk_search():
    vocab = Vocabulary(guests={"bernard macmahon": "Bernard MacMahon"})
    db = FakeDB(
        episodes=[
            {"video_id": "Te50Pm9oQsY", "channel": "Rick Rubin - Tetragrammaton", "title": "Bernard MacMahon", "guests": []}
        ],
        chunks=[
            {"chunk_uid": "Te50Pm9oQsY:0", "video_id": "Te50Pm9oQsY", "chunk_index": 0, "title": "Bernard MacMahon", "guests": [], "rel": 0.80},
            {"chunk_uid": "Te50Pm9oQsY:1", "video_id": "Te50Pm9oQsY", "chunk_index": 1, "title": "Bernard MacMahon", "guests": [], "rel": 0.78},
            {"chunk_uid": "Te50Pm9oQsY:2", "video_id": "Te50Pm9oQsY", "chunk_index": 2, "title": "Bernard MacMahon", "guests": [], "rel": 0.76},
        ],
    )
    # The blind hybrid search returns only the wrong episode (the 0.0 case).
    wrong = [
        {"chunk_uid": "WRONG:0", "video_id": "WRONG", "title": "A different episode", "guests": [], "rel": 1.0, "rrf_score": 0.0},
        {"chunk_uid": "WRONG:1", "video_id": "WRONG", "title": "A different episode", "guests": [], "rel": 0.5, "rrf_score": 0.0},
        {"chunk_uid": "WRONG:2", "video_id": "WRONG", "title": "A different episode", "guests": [], "rel": 0.4, "rrf_score": 0.0},
    ]
    assert "Te50Pm9oQsY" not in {d["video_id"] for d in wrong}  # baseline misses it

    tools = make_tools(db, wrong, vocab=vocab)
    state = run_agent("What does Bernard MacMahon discuss with Rick Rubin?", tools)

    assert state.plan.intent is Intent.ENTITY_LOOKUP
    video_ids = {d["video_id"] for d in state.docs}
    assert "Te50Pm9oQsY" in video_ids  # recovered via the context graph
    assert state.docs[0]["video_id"] == "Te50Pm9oQsY"  # and ranked #1
    assert state.grade.sufficient


def test_thematic_route_happy_path():
    vocab = Vocabulary(topics={"a&r": "a&r"})
    docs = [
        {"chunk_uid": f"V{i}:0", "video_id": f"V{i}", "title": f"Ep {i}", "guests": [], "rel": 0.9 - i * 0.1}
        for i in range(4)
    ]
    tools = make_tools(FakeDB(), docs, vocab=vocab)
    state = run_agent("How do A&R find new artists?", tools)
    assert state.plan.intent is Intent.THEMATIC
    assert state.rewrites == 0
    assert len(state.docs) >= 3
    assert state.grade.sufficient


def test_thematic_route_diversifies_clustered_episode_hits():
    vocab = Vocabulary(topics={"a&r": "a&r"})
    docs = [
        {"chunk_uid": "A:0", "video_id": "A", "title": "Ep A", "guests": [], "rel": 1.0},
        {"chunk_uid": "A:1", "video_id": "A", "title": "Ep A", "guests": [], "rel": 0.99},
        {"chunk_uid": "A:2", "video_id": "A", "title": "Ep A", "guests": [], "rel": 0.98},
        {"chunk_uid": "B:0", "video_id": "B", "title": "Ep B", "guests": [], "rel": 0.9},
        {"chunk_uid": "C:0", "video_id": "C", "title": "Ep C", "guests": [], "rel": 0.8},
        {"chunk_uid": "D:0", "video_id": "D", "title": "Ep D", "guests": [], "rel": 0.7},
    ]
    tools = make_tools(FakeDB(), docs, vocab=vocab, top_k=4)
    state = run_agent("How do A&R spot promising artists?", tools)

    assert state.plan.intent is Intent.THEMATIC
    assert [doc["video_id"] for doc in state.docs] == ["A", "B", "C", "D"]


def test_insufficient_entity_lookup_triggers_rewrite_to_thematic():
    # Guest is in the vocabulary but the graph has no episode for them and the
    # blind search returns unrelated docs -> grade fails -> broaden to thematic.
    vocab = Vocabulary(guests={"ghost guest": "Ghost Guest"})
    docs = [
        {"chunk_uid": f"U{i}:0", "video_id": f"U{i}", "title": f"Unrelated {i}", "guests": [], "rel": 0.8 - i * 0.1}
        for i in range(3)
    ]
    tools = make_tools(FakeDB(), docs, vocab=vocab, max_rewrites=1)
    state = run_agent("What does Ghost Guest say about touring?", tools)
    assert state.rewrites == 1
    assert state.plan.intent is Intent.THEMATIC
    assert len(state.docs) >= 3
    assert state.grade.sufficient


def test_comparative_route_decomposes():
    vocab = Vocabulary(guests={"jimmy iovine": "Jimmy Iovine", "boi-1da": "Boi-1da"})
    docs = [
        {"chunk_uid": "A:0", "video_id": "A", "title": "Ep A", "guests": [], "rel": 0.9},
        {"chunk_uid": "B:0", "video_id": "B", "title": "Ep B", "guests": [], "rel": 0.8},
    ]
    tools = make_tools(FakeDB(), docs, vocab=vocab, max_rewrites=0)
    state = run_agent("How do Jimmy Iovine and Boi-1da differ on branding?", tools)
    assert state.plan.intent is Intent.COMPARATIVE
    assert state.plan.subqueries
    assert state.docs


def test_best_per_video_dedupes_preserving_order():
    docs = [
        {"video_id": "A", "chunk_uid": "A:0"},
        {"video_id": "A", "chunk_uid": "A:1"},
        {"video_id": "B", "chunk_uid": "B:0"},
    ]
    out = best_per_video(docs)
    assert [d["video_id"] for d in out] == ["A", "B"]


def test_diversify_by_video_backfills_after_episode_coverage():
    docs = [
        {"video_id": "A", "chunk_uid": "A:0"},
        {"video_id": "A", "chunk_uid": "A:1"},
        {"video_id": "B", "chunk_uid": "B:0"},
        {"video_id": "C", "chunk_uid": "C:0"},
    ]
    out = diversify_by_video(docs, limit=4, max_per_video=2, min_videos=3)
    assert [d["video_id"] for d in out] == ["A", "B", "C", "A"]
