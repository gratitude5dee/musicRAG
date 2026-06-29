from musicrag.config import build_mongodb_uri, normalize_mongodb_host


def test_normalize_mongodb_host_accepts_shell_style_uri():
    assert (
        normalize_mongodb_host("mongodb+srv://cluster0.example.mongodb.net/")
        == "cluster0.example.mongodb.net"
    )


def test_build_mongodb_uri_prefers_explicit_uri():
    explicit = "mongodb+srv://example.invalid/"
    assert build_mongodb_uri(explicit, "host", "user", "password") == explicit


def test_build_mongodb_uri_from_split_values_encodes_credentials():
    uri = build_mongodb_uri(
        explicit_uri="",
        host="mongodb+srv://cluster0.example.mongodb.net/",
        username="db_user",
        password="p@ss word",
        options="retryWrites=true&w=majority",
    )
    assert uri == (
        "mongodb+srv://db_user:p%40ss+word@cluster0.example.mongodb.net/"
        "?retryWrites=true&w=majority"
    )


def test_build_mongodb_uri_returns_empty_when_split_values_are_incomplete():
    assert build_mongodb_uri("", "cluster0.example.mongodb.net", "db_user", "") == ""
