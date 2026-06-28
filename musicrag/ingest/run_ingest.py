from __future__ import annotations

import argparse

from musicrag.config import settings
from musicrag.ingest import build_graph, create_indexes, parse_sources
from musicrag.ingest.embed_store import VoyageEmbedder, embed_episode_records
from musicrag.ingest.chunk import iter_chunk_records


def main() -> None:
    parser = argparse.ArgumentParser(description="Run P1-P4 MusicRAG ingestion.")
    parser.add_argument("--sample", type=int)
    parser.add_argument("--resume", action="store_true", help="Skip unchanged embeddings. Default behavior.")
    parser.add_argument("--skip-index-wait", action="store_true")
    args = parser.parse_args()

    cfg = settings()
    episodes, channels, entities = parse_sources.build_catalog(cfg)
    parse_sources.upsert_catalog(episodes, channels, entities)
    print(f"P1 catalog: {len(episodes)} episodes, {len(channels)} channels, {len(entities)} entities")

    embedder = VoyageEmbedder(cfg)
    written = skipped = 0
    for row, records in iter_chunk_records(cfg, args.sample):
        w, s = embed_episode_records(cfg, embedder, records)
        written += w
        skipped += s
        print({"video_id": row.video_id, "written": w, "skipped": s})
    print(f"P2/P3 chunks embedded: written={written} skipped={skipped}")

    entity_count = build_graph.rebuild_entities_from_episodes()
    episode_count = build_graph.sync_episode_chunk_counts()
    print(f"P4 graph: {entity_count} entities, {episode_count} episodes with chunks")

    create_indexes.ensure_standard_indexes()
    chunks = create_indexes.get_db().chunks
    create_indexes.ensure_search_index(
        chunks,
        create_indexes.VECTOR_INDEX_NAME,
        "vectorSearch",
        create_indexes.VECTOR_INDEX_DEFINITION,
    )
    create_indexes.ensure_search_index(
        chunks,
        create_indexes.TEXT_INDEX_NAME,
        None,
        create_indexes.TEXT_INDEX_DEFINITION,
    )
    if not args.skip_index_wait:
        create_indexes.wait_until_queryable(
            chunks, [create_indexes.VECTOR_INDEX_NAME, create_indexes.TEXT_INDEX_NAME]
        )
    print("Ingestion complete.")


if __name__ == "__main__":
    main()

