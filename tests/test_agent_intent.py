from musicrag.agent.intent import Intent, Vocabulary, classify_intent

VOCAB = Vocabulary(
    guests={
        "bernard macmahon": "Bernard MacMahon",
        "jimmy iovine": "Jimmy Iovine",
        "boi-1da": "Boi-1da",
    },
    channels={
        "rick rubin - tetragrammaton": "Rick Rubin - Tetragrammaton",
        "engineears podcast": "EngineEars Podcast",
    },
    topics={"a&r": "a&r", "branding": "branding", "artist development": "artist development"},
)


def test_named_guest_routes_to_entity_lookup():
    plan = classify_intent("What does Bernard MacMahon discuss with Rick Rubin?", VOCAB)
    assert plan.intent is Intent.ENTITY_LOOKUP
    assert "Bernard MacMahon" in plan.guests


def test_conceptual_query_is_thematic():
    plan = classify_intent("How do A&R find new artists?", VOCAB)
    assert plan.intent is Intent.THEMATIC
    assert "a&r" in plan.topics
    assert plan.guests == []


def test_two_entities_with_compare_cue_is_comparative():
    plan = classify_intent("How do Jimmy Iovine and Boi-1da differ on branding?", VOCAB)
    assert plan.intent is Intent.COMPARATIVE
    assert plan.subqueries  # decomposed into per-entity sub-queries


def test_aggregation_cue_without_guest_is_aggregative():
    plan = classify_intent("What are common themes across episodes about branding?", VOCAB)
    assert plan.intent is Intent.AGGREGATIVE


def test_to_filters_maps_first_of_each():
    plan = classify_intent("What does Boi-1da say about branding?", VOCAB)
    filters = plan.to_filters()
    assert filters["guest"] == "Boi-1da"
    assert filters.get("topic") == "branding"


def test_unknown_terms_default_to_thematic():
    plan = classify_intent("How does mastering loudness affect streaming?", Vocabulary())
    assert plan.intent is Intent.THEMATIC


def test_smart_apostrophe_matches_straight_apostrophe():
    # Graph stores a curly apostrophe; the user types a straight one.
    vocab = Vocabulary(guests={"adam d’angelo": "Adam D’Angelo"})
    plan = classify_intent("What does Adam D'Angelo discuss with Rick Rubin?", vocab)
    assert plan.intent is Intent.ENTITY_LOOKUP
    assert "Adam D’Angelo" in plan.guests
