# MusicRAG — Goal Document

**A build specification for an autonomous coding agent (Codex / Claude Cowork) to vectorize the `MusicIndustryTranscripts/transcripts` corpus for semantic search and RAG on MongoDB.**

| | |
|---|---|
| **Project** | `musicrag` |
| **Owner** | GRATITUD3 |
| **Author** | Principal RAG / Cognitive Architect |
| **Status** | Ready to implement |
| **Date** | 2026-06-28 |
| **Doc type** | Agent-executable goal/spec (read top-to-bottom; each Phase has a Definition of Done) |

---

## 0. Mission (read this first)

Turn the on-disk podcast transcript corpus under
`/Users/gratitud3/Downloads/musicindustry/musicindustrytranscripts/transcripts/`
into a **production semantic-search + RAG system on MongoDB Atlas**, where:

1. Every transcript is **chunked with timestamps**, **embedded with Voyage AI (MongoDB-native)**, and stored in `music_rag.chunks`.
2. A **metadata context-graph** (channel ↔ episode ↔ guest ↔ topic) lets retrieval filter, boost, and navigate.
3. A **Python retrieval module** performs hybrid (vector + full-text) search → **`rerank-2.5`** → a **grounded, cited answer** (each citation deep-links to the exact second of the YouTube video).
4. The **Vercel/Next.js chat UI** (adapted from `MongoDB-RAG-Vercel-master`) serves it end-to-end.

This document is the single source of truth. Build it phase by phase (P0 → P8). Do not skip the **Definition of Done (DoD)** checks.

---

## 1. Locked decisions

These were chosen by the owner and are **not** open for re-litigation by the implementing agent:

| Decision | Choice | Consequence |
|---|---|---|
| **Stack** | **Python ingestion + Vercel/Next.js chat UI** | Heavy lifting (parse, chunk, embed, index, graph) is offline Python; the existing Next.js app is the serving front-end over the same Atlas collection. |
| **Embeddings + rerank** | **Voyage AI via MongoDB-native API** | `voyage-context-4` (primary) / `voyage-4-large` (fallback) at **1024 dims**, `rerank-2.5`. Endpoint `https://ai.mongodb.com/v1`. |
| **Scope** | **Full app** | Ingest + index + retrieval module + working chat UI with citations + filters. |
| **Context graph** | **Metadata graph + filters** | Build channel/episode/guest/topic nodes from existing `metadata.json` + tags; use as retrieval filters/boosts and for "related" navigation. No full LLM knowledge-graph extraction. |

Reference repos already in the workspace (read them, reuse them, do not fork blindly):

- `mdb-agent-builder-main/` — Python, LangChain + LangGraph, `langchain-mongodb`. Ships a **Voyage embedding adapter** (`agent_builder/embeddings/adapters.py`), a **MongoDB hybrid-search tool** (`agent_builder/tools/mongodb.py` — `MongoDBAtlasVectorSearch` + `MongoDBAtlasFullTextSearchRetriever` + NL→MQL), and a **ReAct-RAG example** (`examples/react_rag_mongodb.yaml`). Use it as the canonical pattern for the Python retrieval/agent layer.
- `MongoDB-RAG-Vercel-master/` — Next.js 14 + LangChain.js + `MongoDBAtlasVectorSearch`. `src/utils/openai.ts` defines the vector-store wiring; `src/app/api/upload/route.ts` is the ingest reference; `src/app/api/chat/route.ts` is the chat chain. **This is the UI we adapt.**

---

## 2. Objective & non-goals

**Objective.** A repeatable, idempotent, resumable pipeline that vectorizes 939 transcripts (~9.2M words) and a chat experience that answers music-industry questions with verbatim, timestamped citations.

**Non-goals (explicitly out of scope).**

- No audio/video re-transcription. Captions on disk are the source of truth.
- No full LLM entity/relationship knowledge graph (metadata graph only).
- No fine-tuning. Retrieval quality comes from chunking + Voyage models + reranking.
- No multi-tenant auth / billing. Single-project demo-grade app.

---

## 3. Success criteria (acceptance tests)

The build is **done** when all of the following pass (see Phase P7 for the harness):

- [ ] **Coverage:** `music_rag.chunks` contains chunks for **≥ 95%** of episodes where `has_transcript = true` (≥ ~892 of 939). Every chunk has a non-null 1024-d `embedding`.
- [ ] **Index live:** `vector_index` (vectorSearch) and `text_index` (full-text) report `queryable: true`.
- [ ] **Timestamped citations:** ≥ 90% of chunks derived from an `.srt` carry `start_sec`/`end_sec`; the UI renders each source as a clickable `https://www.youtube.com/watch?v=<id>&t=<start>s` link that lands within ±3s of the quoted line.
- [ ] **Retrieval quality:** on the golden set (`eval/golden.jsonl`, ≥ 30 Qs), **Recall@10 ≥ 0.85** and **MRR@10 ≥ 0.6** after reranking.
- [ ] **Groundedness:** LLM-as-judge groundedness ≥ 0.9 (answers supported by retrieved chunks; no fabricated quotes).
- [ ] **Graph filters work:** a query scoped to a channel/guest/topic returns only matching sources; "more from this guest" returns ≥ 3 related episodes when they exist.
- [ ] **Idempotent re-run:** running the ingest orchestrator twice produces **zero duplicate chunks** and re-embeds nothing unchanged.
- [ ] **UI end-to-end:** ask a question in the Next.js app → streamed answer + a Sources panel with deep-links and channel/guest/date facets.

---

## 4. Source data inventory (ground truth)

Path: `musicindustrytranscripts/transcripts/<Channel>/<Episode Folder [VIDEO_ID]>/`

| Fact | Value |
|---|---|
| Channels | **9** (`And The Writer Is`, `David Senra`, `Engineears Podcast`, `IDEA GENERATION`, `Managers Playbook`, `Neighborhood Art Supply`, `One More Time Podcast`, `Red Bull Music Academy`, `Rick Rubin - Tetragrammaton`) |
| Episodes indexed | **1,087** |
| With transcript | **939** (86%) |
| Without captions | **148** → graph nodes only, excluded from vector store |
| Caption types | `apify` 697, `auto` 242, `none` 148 |
| Total transcribed words | **~9.2M** → **~12.2M tokens** |
| Word-count buckets | `<1k`: 28 · `1–5k`: 368 · `5–10k`: 100 · `10k+`: 443 |
| Longest transcript | **38,599 words (~51k tokens)** → exceeds single-request context; **must** be split |

**Per-episode files**

| File | Use |
|---|---|
| `transcript.txt` | Canonical clean-ish text (run-on, mostly lowercase for `auto`). Fallback chunk source when no SRT. |
| `transcript.srt` | **Timestamped** cues — the source for citable chunks. ⚠️ `auto`/`apify` SRTs use *rolling captions*: consecutive cues repeat overlapping text and include 10 ms micro-cues (see sample below). **De-duplication is mandatory.** |
| `metadata.json` | Rich: `video_id, title, channel, channel_id, channel_url, video_url, upload_date, duration_seconds, view_count, like_count, uploader, language, categories, tags[], thumbnail, description` (description often contains chapter timestamps), `caption_type`. **Primary graph source.** |
| `NO_TRANSCRIPT.txt` | Marker for the 148 caption-less episodes. |

**Corpus-level helpers (reuse, don't reinvent)**

- `transcripts/_index.csv` — master index: `channel,video_id,title,upload_date,duration_seconds,caption_type,has_transcript,word_count,folder`. **Drive ingestion enumeration from this file**, not a raw directory walk.
- `transcripts/_QA_REPORT.md` — coverage report.
- `build_index.py` — regenerates `_index.csv` + QA report from disk (resumable, no network). Re-run after any corpus change.
- `enum/*.jsonl` (20 files) — per-channel video enumerations (`id,title,duration,view_count,url`).

**Rolling-caption sample (why dedup matters):**
```
1  00:00:03,990 --> 00:00:04,000  this is is a good segue um how do you
2  00:00:04,000 --> 00:00:07,549  this is is a good segue um how do you identify a great
3  00:00:10,110 --> 00:00:10,120  artist oh there's so many things well
4  00:00:10,120 --> 00:00:12,310  artist oh there's so many things well let's say this like I could simplify
```
Naively concatenating cue text triples the token count and destroys chunk quality. The chunker (Phase P2) must collapse this to the unique spoken stream while preserving the earliest timestamp per token span.

---

## 5. Target architecture

```
                         ┌──────────────────────────────────────────────────────────┐
   OFFLINE (Python)      │  PHASE P1  parse_sources.py                               │
   musicrag/ingest/      │   _index.csv + metadata.json  ─▶  episodes / channels /    │
                         │                                    entities  records       │
                         │  PHASE P2  srt_chunker.py                                  │
                         │   transcript.srt ─▶ dedup ─▶ timestamped, token-windowed   │
                         │                              chunks (start_sec/end_sec)     │
                         │  PHASE P3  embed_store.py                                  │
                         │   chunks ─▶ Voyage (ai.mongodb.com) voyage-context-4 ─▶     │
                         │            1024-d vectors ─▶ upsert music_rag.chunks        │
                         │  PHASE P4  build_graph.py + create_indexes.py             │
                         │   entities/edges + vector_index + text_index + btree       │
                         └───────────────┬──────────────────────────────────────────┘
                                         │  MongoDB Atlas  (db: music_rag)
                                         │  chunks · episodes · channels · entities
                         ┌───────────────┴──────────────────────────────────────────┐
   QUERY (Python lib)    │  PHASE P5  query/                                         │
   + reused by UI        │   embed(query, input_type="query")                        │
                         │     ─▶ $vectorSearch (+graph filters) ⊕ full-text          │
                         │     ─▶ reciprocal-rank fusion                              │
                         │     ─▶ rerank-2.5 (top 40 → top 8)                         │
                         │     ─▶ grounded answer w/ deep-link citations             │
                         └───────────────┬──────────────────────────────────────────┘
                                         │  same collection + index
                         ┌───────────────┴──────────────────────────────────────────┐
   ONLINE (Next.js)      │  PHASE P6  web/ (adapted MongoDB-RAG-Vercel)              │
                         │   /api/chat  ─▶ retrieve+rerank+stream answer             │
                         │   Sources panel (deep-links) · channel/guest/date facets  │
                         └──────────────────────────────────────────────────────────┘
```

Design principles (cognitive-architecture lens):

- **Citations are first-class, not decoration.** Timestamps flow from SRT → chunk → MongoDB → UI deep-link. This is the single biggest trust lever for a spoken-word corpus.
- **Context beats cleverness.** Use `voyage-context-4` contextualized chunk embeddings so each chunk is encoded *in the context of its whole episode* — critical for podcasts where pronouns/topics span minutes.
- **The graph is a retrieval prior, not a separate product.** Denormalize `channel/guests/topics/upload_date` onto every chunk so `$vectorSearch` can pre-filter; keep an `entities` collection for navigation.
- **Idempotent & resumable by construction.** Mirror `build_index.py`'s "reflect on-disk state" philosophy: every stage can re-run safely.

---

## 6. MongoDB data model

**Database:** `music_rag`. **Standardize the embedding field name as `embedding` everywhere** (Python and the Vercel app) — do not use the Vercel repo's default `text_embedding`.

### 6.1 `chunks` (the vector store)

```jsonc
{
  "_id": "ObjectId",
  "chunk_uid": "MXFmnC9dhQU:0007",      // `${video_id}:${chunk_index zero-padded}` (unique)
  "video_id": "MXFmnC9dhQU",
  "channel": "Managers Playbook",
  "title": "How PARTYNEXTDOOR wrote Rihanna's HIT Record",
  "text": "clean chunk text, rolling-caption-deduped ...",
  "embedding": [/* 1024 floats, voyage-context-4 / voyage-4-large */],

  // --- citation / playback ---
  "start_sec": 405.2,                    // null if derived from txt (no SRT)
  "end_sec": 437.8,
  "deep_link": "https://www.youtube.com/watch?v=MXFmnC9dhQU&t=405s",

  // --- graph filter fields (denormalized for $vectorSearch pre-filtering) ---
  "guests": ["Tyler Henry"],
  "topics": ["artist management", "songwriting camp", "publishing"],
  "upload_date": "2024-06-04",           // ISO; also store upload_ts (epoch) for range filters
  "view_count": 1261,
  "caption_type": "auto",

  // --- chunk bookkeeping ---
  "chunk_index": 7,
  "chunk_count": 31,
  "token_count": 512,
  "word_count": 380,

  // --- idempotency / provenance ---
  "content_hash": "sha256(text)",        // skip re-embed when unchanged
  "embed_model": "voyage-context-4",
  "embed_dims": 1024,
  "source_path": "transcripts/Managers Playbook/How PARTYNEXTDOOR ... [MXFmnC9dhQU]/transcript.srt",
  "schema_version": 1,
  "ingested_at": "2026-06-28T16:30:00Z"
}
```

Uniqueness: unique index on `chunk_uid`. Upsert key: `chunk_uid`; re-embed only when `content_hash` changes.

### 6.2 `episodes` (graph node + catalog)

```jsonc
{
  "_id": "ObjectId",
  "video_id": "MXFmnC9dhQU",
  "channel": "Managers Playbook",
  "channel_id": "UCEM2vVVIqCJAsDzE0xJHLMQ",
  "title": "How PARTYNEXTDOOR wrote Rihanna's HIT Record",
  "video_url": "https://www.youtube.com/watch?v=MXFmnC9dhQU",
  "thumbnail": "https://i.ytimg.com/vi/MXFmnC9dhQU/maxresdefault.jpg",
  "upload_date": "2024-06-04",
  "duration_seconds": 682,
  "view_count": 1261,
  "like_count": 55,
  "language": "en-US",
  "caption_type": "auto",
  "has_transcript": true,
  "word_count": 1990,
  "chunk_count": 31,
  "guests": ["Tyler Henry"],
  "topics": ["artist management", "publishing"],
  "chapters": [ {"t": 0, "label": "How do you identify a great artist?"}, {"t": 405, "label": "Rihanna writing camp"} ],
  "source_folder": "How PARTYNEXTDOOR ... [MXFmnC9dhQU]",
  "schema_version": 1
}
```

### 6.3 `channels` (graph node)

```jsonc
{
  "_id": "ObjectId",
  "channel": "Managers Playbook",
  "channel_id": "UCEM2vVVIqCJAsDzE0xJHLMQ",
  "channel_url": "https://www.youtube.com/channel/UCEM2vVVIqCJAsDzE0xJHLMQ",
  "episode_count": 344,
  "transcribed_count": 344,
  "schema_version": 1
}
```

### 6.4 `entities` (guests & topics — graph nodes)

```jsonc
{
  "_id": "ObjectId",
  "name": "Tyler Henry",
  "type": "guest",                       // "guest" | "topic"
  "slug": "tyler-henry",
  "episode_ids": ["MXFmnC9dhQU", "..."],
  "episode_count": 4,
  "channels": ["Managers Playbook"],
  "schema_version": 1
}
```

Edges are represented by the denormalized arrays (`episodes.guests`, `episodes.topics`) plus `entities.episode_ids` back-references — sufficient for filters, boosts, and "related" navigation without a separate edges collection.

---

## 7. Context graph (metadata graph + filters)

**Nodes:** `Channel` (9) · `Episode` (1,087) · `Guest` · `Topic`.
**Edges:** `Channel —HAS_EPISODE→ Episode`, `Episode —FEATURES→ Guest`, `Episode —ABOUT→ Topic`, `Guest —APPEARS_IN→ Episode`.

**Extraction (pragmatic, metadata-only — no transcript LLM pass):**

- **Guests:** parse `metadata.title` patterns (`"Andrew Watt | How He Became..."`, `"Ep. 228- Hit-Boy - ..."`, `"... (Nima Nasseri) ..."`) + high-signal `tags[]` (proper-noun person tags). Normalize casing/aliases with a small static alias map; optionally one cheap LLM normalization pass over the *deduped candidate name list only* (not transcripts).
- **Topics:** union of curated `tags[]` (drop channel-boilerplate tags like "music podcast") + chapter labels from `description`. Map to a controlled vocabulary of ~40 music-industry topics (A&R, publishing, mixing, marketing, sync, touring, deal structure, songwriting, etc.).

**How the graph is used at query time:**

1. **Pre-filter:** parsed query facets (channel / guest / topic / date range) become a `filter` inside `$vectorSearch` → smaller, more precise candidate set.
2. **Boost:** chunks whose episode matches an inferred guest/topic get a fusion-score boost.
3. **Navigate:** answer footer offers "More from **Tyler Henry**" / "Related episodes on **publishing**" via `entities.episode_ids`.
4. **Facets:** the UI renders channel/guest/topic/date facets sourced from `channels` + `entities`.

---

## 8. Chunking strategy (the core)

Spoken-word transcripts are the hardest part. Follow this exactly.

### 8.1 Build a clean, timestamped token stream (per episode)

If `transcript.srt` exists:
1. Parse cues `(start, end, text)`.
2. **Collapse rolling captions:** maintain a running token buffer; for each new cue, append only the suffix not already present (longest-common-prefix against the buffer tail). Record the cue's `start` as the timestamp of the *first* appearance of each newly added token span. Drop empty/10 ms micro-cues that add no new tokens.
3. Result: ordered `(token, t_start)` stream with no rolling duplication.

If only `transcript.txt` exists: tokenize the text; `start_sec`/`end_sec` = `null` (still embed and store; mark `caption_type`).

### 8.2 Window into chunks

- **Target size:** ~**500 tokens**, **overlap ~75 tokens (15%)**.
- **Boundaries:** break at sentence punctuation when present; otherwise at cue boundaries. Never split inside a cue.
- **Stamp:** `start_sec` = t of first token in chunk; `end_sec` = t of last token; `deep_link` from `start_sec` (floor to int seconds).
- **Tiny episodes** (`word_count < 1000`, 28 of them): single chunk is fine.

Expected output: **~25,000–30,000 chunks** total.

### 8.3 Embed with context (primary) — `voyage-context-4`

Use **contextualized chunk embeddings** so each chunk is encoded with full-episode context:

- Group an episode's ordered chunks and call `contextualized_embed(inputs=[[chunk0, chunk1, ...]], model="voyage-context-4", input_type="document")`.
- **Token cap:** when passing pre-chunked inputs (no auto-chunk), the **request total must be ≤ 32k tokens**. Long episodes (up to ~51k tokens) therefore must be split into **consecutive context-groups of ≤ ~28k tokens** (a handful of contiguous sub-windows per long episode), preserving local context within each group. Map returned `results[i].embeddings[j]` back to the j-th chunk of group i.
- All `voyage-4` / `voyage-context-4` outputs are **1024-d** and mutually compatible.

### 8.4 Fallback path — `voyage-4-large`

Simpler, no grouping math: embed chunks in batches with `embed(texts=[...], model="voyage-4-large", input_type="document")` (≤ 1000 inputs and ≤ 120k tokens per request). Same 1024-d, same `dotProduct` index — **interchangeable** with the context-4 vectors at the index level. Record whichever was used in `embed_model`.

> **Rule:** never mix embedding *dimensions* in one index. context-4 and voyage-4-large are both 1024-d → safe. Do **not** introduce OpenAI 1536-d vectors into this index.

---

## 9. Embedding pipeline (Voyage AI via MongoDB)

**Access.** Create a **model API key** in the Atlas UI (AI Models → Create model API key). Export `VOYAGE_API_KEY`. The official `voyageai` Python client (≥ 0.3.7) **auto-routes Atlas model keys to `https://ai.mongodb.com/`** — no base-url override needed. (Raw REST: `POST https://ai.mongodb.com/v1/embeddings`, `Authorization: Bearer $VOYAGE_API_KEY`.)

**Always set `input_type`:** `"document"` when embedding chunks, `"query"` when embedding a user query. This measurably improves retrieval and is required for correctness here.

**Batching & limits (Tier-1 reference).**

| Model | Dims | Per-request caps | Rate (Tier 1) |
|---|---|---|---|
| `voyage-context-4` | 1024 | ≤ 32k tokens/request (pre-chunked) | 3M TPM · 2000 RPM |
| `voyage-4-large` | 1024 | ≤ 1000 inputs, ≤ 120k tokens/request | 3M TPM · 2000 RPM |
| `rerank-2.5` | — | ≤ 1000 docs; total ≤ 600k tokens | 2M TPM · 2000 RPM |

Implement: token-budgeted batching, exponential backoff on `429`, `max_retries=3`, `timeout=30`. Checkpoint after each episode so a crash resumes cleanly.

**Idempotency.** For each chunk compute `content_hash = sha256(text)`. Before embedding, look up `chunk_uid`; if it exists with the same `content_hash` **and** `embed_dims == 1024`, skip. Upsert results by `chunk_uid`.

**Free-tier reality.** Document corpus ≈ **12.2M tokens** vs **200M free tokens** for `voyage-context-4` / `voyage-4-large` → **the full initial embed is expected to cost $0** (≈ $1.47 if it were billed at $0.12/1M). Reranking is per-query and also has a 200M free allowance.

---

## 10. Index definitions

Create these via `pymongo` `SearchIndexModel` in `create_indexes.py` (idempotent: check `list_search_indexes`, wait for `queryable: true`). Atlas tier: **M0 free works for dev**; use **M10+** for the full ~25–30k-vector corpus and concurrent UI traffic.

### 10.1 Vector index — `vector_index` on `music_rag.chunks`

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "dotProduct" },
    { "type": "filter", "path": "channel" },
    { "type": "filter", "path": "guests" },
    { "type": "filter", "path": "topics" },
    { "type": "filter", "path": "video_id" },
    { "type": "filter", "path": "caption_type" },
    { "type": "filter", "path": "upload_ts" }
  ]
}
```
`dotProduct` is correct because Voyage vectors are L2-normalized (dot product ≡ cosine, faster). Store `upload_ts` (epoch int) alongside `upload_date` for numeric range filtering.

### 10.2 Full-text index — `text_index` on `music_rag.chunks`

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "text":  { "type": "string", "analyzer": "lucene.english" },
      "title": { "type": "string", "analyzer": "lucene.english" },
      "guests":{ "type": "string" },
      "topics":{ "type": "string" }
    }
  }
}
```

### 10.3 Standard indexes (graph traversal / catalog)

- `chunks`: unique `chunk_uid`; compound `{ video_id: 1, chunk_index: 1 }`.
- `episodes`: unique `video_id`; `{ channel: 1 }`, `{ guests: 1 }`, `{ topics: 1 }`, `{ upload_ts: -1 }`.
- `entities`: unique `{ type: 1, slug: 1 }`; `{ episode_ids: 1 }`.
- `channels`: unique `channel`.

---

## 11. Retrieval & RAG

Reference implementation in `musicrag/query/` (mirrors the hybrid pattern in `mdb-agent-builder-main/agent_builder/tools/mongodb.py`). The Next.js app calls the same logical pipeline.

**Pipeline (per query):**

1. **Understand & filter.** Optionally parse the query (or read UI facets) into `{ channel?, guest?, topic?, date_range? }`. Build a MongoDB `filter` expression.
2. **Embed query.** `voyage` with `input_type="query"`, same model family as the corpus.
3. **Vector search.** `$vectorSearch` on `vector_index`, `numCandidates ≈ 200`, `limit = 40`, with the `filter` from step 1.
4. **Full-text search.** Parallel `$search` on `text_index` (`limit = 40`) for lexical/BM25 recall (names, song titles, exact phrases).
5. **Fuse.** Combine with **Reciprocal Rank Fusion** (`k = 60`). *(Atlas 8.1+: you may use the native `$rankFusion` stage instead of manual RRF.)*
6. **Rerank.** `rerank-2.5` over the fused top ~40 → keep **top 8**. Apply graph **boosts** (guest/topic match) before the cut.
7. **Assemble context.** For each kept chunk include `text`, `title`, `channel`, `guests`, `start_sec`, `deep_link`. Optionally widen to neighbor chunks (`chunk_index ± 1`) for continuity.
8. **Generate.** Grounded prompt → LLM (Claude `claude-sonnet-4-5` or OpenAI `gpt-4o`). The system prompt **must** require inline citations like `[Title @ 6:45](deep_link)` and forbid unsupported claims.
9. **Return** `{ answer, sources[] }` where each source = `{ title, channel, guests, deep_link, start_sec, snippet }`.

**$vectorSearch stage (canonical):**
```jsonc
{ "$vectorSearch": {
    "index": "vector_index",
    "path": "embedding",
    "queryVector": queryEmbedding,   // 1024-d, input_type="query"
    "numCandidates": 200,
    "limit": 40,
    "filter": { "channel": { "$eq": "Managers Playbook" } }   // optional, from graph facets
}}
```

---

## 12. Vercel chat UI wiring (`web/`)

Copy `MongoDB-RAG-Vercel-master/` → `web/` and make these **specific** changes. The repo defaults to OpenAI 1536-d and field `text_embedding`; we move it to Voyage 1024-d and field `embedding`, pointed at `music_rag.chunks`.

1. **`src/utils/` — replace the embeddings + vector-store wiring** (`openai.ts` → `voyage.ts`):
   - Implement a small `VoyageEmbeddings` class (LangChain `Embeddings` interface) that calls `POST https://ai.mongodb.com/v1/embeddings` with `model = voyage-4-large` (or `voyage-context-4`), `input_type` = `"query"` for `embedQuery`, `"document"` for `embedDocuments`, `Authorization: Bearer ${process.env.VOYAGE_API_KEY}`.
   - `searchArgs`: `{ collection: music_rag.chunks, indexName: "vector_index", textKey: "text", embeddingKey: "embedding" }`.
2. **`src/app/api/chat/route.ts`** — replace the bare `ConversationalRetrievalQAChain`/MMR retriever with the **Section 11 pipeline**: vector + full-text → RRF → `rerank-2.5` → grounded answer. Accept optional `filters` (channel/guest/topic/date) in the request body and pass them into `$vectorSearch.filter`. Return `sources[]` with the answer.
3. **Remove/repurpose ingestion in the UI.** Ingestion is offline Python; delete the PDF-upload path (`src/app/api/upload/route.ts`, `teach` page) **or** repurpose the "Train" tab into a read-only corpus browser. Do not let the UI write chunks.
4. **Sources panel + facets.** Render each source as a clickable `deep_link` (`▶ Title — Channel @ mm:ss`). Add channel/guest/topic/date facet controls populated from `/api/facets` (reads `channels` + `entities`).
5. **Env.** `.env.local`: `MONGODB_URI`, `VOYAGE_API_KEY`, `OPENAI_API_KEY` **or** `ANTHROPIC_API_KEY`. `numDimensions` in the index **must** be 1024.
6. **Branding.** Title "MusicRAG — Ask the Music Industry Transcripts"; keep the MongoDB/Voyage attribution.

---

## 13. Implementation plan (phases)

Each phase lists deliverables, the command to run, and a **Definition of Done (DoD)**. Do not advance until DoD passes.

### P0 — Prerequisites & setup
- **Do:** Create Atlas cluster (M0 dev / M10+ prod) + DB user + network access. Create a Voyage **model API key** in Atlas. `python -m venv .venv && pip install -r musicrag/requirements.txt`. Fill `.env`.
- **DoD:** `python -c "import voyageai,pymongo,certifi"` ok; a 2-text `voyage-4-large` embed returns vectors of length **1024**; `MongoClient(MONGODB_URI).admin.command('ping')` ok.

### P1 — Parse & normalize → catalog + graph records
- **Do:** `parse_sources.py` reads `transcripts/_index.csv` + each `metadata.json` → upsert `episodes`, `channels`; extract guests/topics → `entities`. Compute `upload_ts`. Mark the 148 caption-less episodes `has_transcript=false`.
- **Run:** `python -m musicrag.ingest.parse_sources`
- **DoD:** `episodes` count == 1087; `channels` == 9; `entities` > 0; spot-check 5 episodes' guests/topics look right.

### P2 — Timestamp-aware chunking
- **Do:** `srt_chunker.py` — SRT parse → rolling-caption dedup → ~500-token / 15%-overlap windows with `start_sec`/`end_sec`; txt fallback when no SRT. Emit chunk records (no embeddings yet).
- **Run:** `python -m musicrag.ingest.chunk --dry-run --sample 3` then full.
- **DoD:** On 3 sample episodes, chunks are readable (no tripled rolling text), `start_sec` increases monotonically, total chunks land in ~25–30k range when run fully; `deep_link` opens the right moment for 3 manual spot-checks.

### P3 — Embed & store (Voyage)
- **Do:** `embed_store.py` — `voyage-context-4` grouped by episode (≤28k-token groups) with `voyage-4-large` fallback; `input_type="document"`; idempotent upsert by `chunk_uid`+`content_hash`.
- **Run:** `python -m musicrag.ingest.embed_store --resume`
- **DoD:** ≥95% of transcribed episodes have chunks; `db.chunks.count_documents({embedding:{$exists:false}})==0`; every `embedding` length 1024; re-running embeds nothing new.

### P4 — Graph finalize + indexes
- **Do:** `build_graph.py` (finalize `entities.episode_ids`, counts) + `create_indexes.py` (vector_index, text_index, btree).
- **Run:** `python -m musicrag.ingest.build_graph && python -m musicrag.ingest.create_indexes`
- **DoD:** both search indexes `queryable:true`; a raw `$vectorSearch` smoke query returns ≥1 hit with a valid `deep_link`.

### P5 — Retrieval + RAG module (Python)
- **Do:** `query/retrieve.py` (hybrid + filters + RRF), `query/rerank.py` (`rerank-2.5`), `query/answer.py` (cited generation), `query/cli.py`.
- **Run:** `python -m musicrag.query.cli "How do A&R find new artists?"`
- **DoD:** returns a grounded answer with ≥3 cited, clickable sources; channel-filtered query returns only that channel.

### P6 — Vercel chat UI
- **Do:** Section 12 changes in `web/`.
- **Run:** `cd web && npm i && npm run dev`
- **DoD:** Ask a question → streamed answer + Sources panel with working deep-links; facet filter changes results.

### P7 — Evaluation & QA
- **Do:** `eval/golden.jsonl` (≥30 Qs w/ expected episode ids), `eval/run_eval.py` (Recall@k, MRR, nDCG; LLM-judge groundedness).
- **Run:** `python -m musicrag.eval.run_eval`
- **DoD:** Recall@10 ≥ 0.85, MRR@10 ≥ 0.6, groundedness ≥ 0.9. Save `eval/report.md`.

### P8 — Ops hardening & handoff
- **Do:** resumability check, re-ingest runbook, `README.md`, cost log, `.env.example` finalized.
- **DoD:** Section 3 acceptance checklist fully green; full pipeline reproducible from a clean clone.

---

## 14. Repo scaffold

```
musicrag/
├── ingest/
│   ├── config.py            # env, clients (pymongo, voyageai), db/collection handles
│   ├── parse_sources.py     # P1: _index.csv + metadata.json -> episodes/channels/entities
│   ├── srt_chunker.py       # P2: SRT dedup + timestamp-aware token windows
│   ├── chunk.py             # P2: orchestrate chunking over corpus
│   ├── embed_store.py       # P3: Voyage embed (context-4 / 4-large) + idempotent upsert
│   ├── build_graph.py       # P4: finalize entity back-references + counts
│   ├── create_indexes.py    # P4: vector + full-text + btree indexes
│   └── run_ingest.py        # one-command orchestrator (P1->P4, resumable)
├── query/
│   ├── retrieve.py          # hybrid vector+full-text + graph filters + RRF
│   ├── rerank.py            # rerank-2.5
│   ├── answer.py            # cited RAG generation
│   └── cli.py               # ad-hoc Q&A
├── eval/
│   ├── golden.jsonl
│   └── run_eval.py
├── .env.example
├── requirements.txt
└── README.md
web/                          # adapted MongoDB-RAG-Vercel-master (Section 12)
```

`requirements.txt` (minimum): `pymongo[srv]`, `certifi`, `voyageai>=0.3.7`, `python-dotenv`, `tiktoken` (token counting), `srt` (or a small custom SRT parser), `anthropic` and/or `openai`.

---

## 15. Configuration & secrets (`.env.example`)

```bash
# --- MongoDB Atlas ---
MONGODB_URI="mongodb+srv://<user>:<pass>@<cluster>/?retryWrites=true&w=majority"
MONGODB_DB="music_rag"

# --- Voyage AI (Atlas model API key; routes to ai.mongodb.com) ---
VOYAGE_API_KEY="<atlas-model-api-key>"
EMBED_MODEL="voyage-context-4"      # or voyage-4-large
EMBED_DIMS="1024"
RERANK_MODEL="rerank-2.5"

# --- Generation LLM (pick one) ---
ANTHROPIC_API_KEY="<key>"           # claude-sonnet-4-5
# OPENAI_API_KEY="<key>"            # gpt-4o

# --- Ingestion knobs ---
CHUNK_TOKENS="500"
CHUNK_OVERLAP="75"
CONTEXT_GROUP_TOKEN_BUDGET="28000"  # < 32k context-4 per-request cap
TRANSCRIPTS_ROOT="../musicindustrytranscripts/transcripts"
```

**Never commit real secrets.** Secrets come from env only; no keys in source or in the goal doc.

---

## 16. Evaluation & QA

- **Golden set** `eval/golden.jsonl`: `{ "q": "...", "expected_video_ids": ["..."], "channel?": "...", "notes": "..." }`. ≥30 questions spanning all 9 channels and a mix of factual / thematic / guest-specific / cross-episode queries.
- **Retrieval metrics:** Recall@{5,10}, MRR@10, nDCG@10 — measured *before vs after* rerank to prove the reranker earns its place.
- **Generation metrics:** groundedness + citation-validity via LLM-as-judge (every quoted claim must trace to a retrieved chunk; every `deep_link` resolves to a real `video_id`).
- **Smoke tests (CI-able):** embedding length == 1024; both indexes queryable; a fixed query returns deterministic top-k ids; no orphan chunks (`video_id` exists in `episodes`).

---

## 17. Cost, scale & performance budget

| Item | Estimate |
|---|---|
| Corpus document tokens | ~12.2M |
| Initial embed cost (`voyage-context-4`/`voyage-4-large`, 200M free) | **$0** (≈ $1.47 if billed) |
| Chunks stored | ~25–30k × 1024 floats |
| Reranking | per-query, 200M-token free tier; ~$0.0025/query if billed |
| Generation | per-query LLM tokens (dominant ongoing cost) |
| Latency target | retrieve+rerank < 1.5s; first answer token < 3s |

Ingestion is a one-time (re-runnable) batch; ongoing cost is dominated by the **generation LLM**, not embeddings.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Rolling-caption duplication** inflates/garbles chunks | Mandatory dedup in `srt_chunker.py` (Section 8.1); DoD spot-check in P2. |
| **Auto-caption quality** (242 `auto`) — no punctuation, ASR errors | Embed anyway; store `caption_type` so UI can caveat; rely on Voyage's robustness + reranker. |
| **148 no-transcript episodes** | Graph nodes only (`has_transcript=false`); excluded from vector store; surfaced as "no transcript available". |
| **Embedding dimension mismatch** (OpenAI 1536 vs Voyage 1024) | Single field `embedding`, single index at 1024; reject any non-1024 vector at write time. |
| **context-4 32k per-request cap** on long episodes (max ~51k tokens) | Token-budgeted context-groups (≤28k); map results back by group/chunk index. |
| **Rate limits / 429** | Backoff + retries + per-episode checkpoint resume. |
| **Atlas tier too small** for vector volume | M0 for dev only; M10+ for full corpus + UI concurrency. |
| **Guest/topic extraction noise** | Controlled topic vocab + alias map; cheap one-pass LLM normalization on the *name list only*. |
| **Index not queryable yet** when querying | `create_indexes.py` waits for `queryable:true` before exit. |

---

## 19. Operational runbook

- **Full rebuild:** `python -m musicrag.ingest.run_ingest` (P1→P4, resumable).
- **Incremental (new episodes added on disk):** re-run `build_index.py` to refresh `_index.csv`, then `run_ingest --resume` — only new/changed `content_hash` chunks are re-embedded.
- **Re-chunk only (strategy change):** bump `schema_version`, delete affected `chunks`, re-run P2→P4.
- **Reindex:** drop + recreate search indexes via `create_indexes.py --force`.
- **Rollback:** keep `schema_version`; query/UI read the current version; old chunks can be purged after validation.

---

## 20. Appendices (copy-paste ready)

### A. Voyage embed helper (Python, MongoDB-native)
```python
import os, voyageai
vo = voyageai.Client(api_key=os.environ["VOYAGE_API_KEY"])  # auto-routes Atlas key -> ai.mongodb.com

def embed_documents(texts: list[str], model="voyage-4-large") -> list[list[float]]:
    return vo.embed(texts, model=model, input_type="document").embeddings  # 1024-d

def embed_query(text: str, model="voyage-4-large") -> list[float]:
    return vo.embed([text], model=model, input_type="query").embeddings[0]

# Contextualized (primary) — group an episode's chunks (≤ ~28k tokens per call):
def embed_episode_chunks(chunks: list[str], model="voyage-context-4") -> list[list[float]]:
    res = vo.contextualized_embed(inputs=[chunks], model=model, input_type="document")
    return res.results[0].embeddings
```

### B. Create the vector index (Python)
```python
from pymongo.operations import SearchIndexModel
chunks.create_search_index(model=SearchIndexModel(
    name="vector_index", type="vectorSearch",
    definition={"fields": [
        {"type":"vector","path":"embedding","numDimensions":1024,"similarity":"dotProduct"},
        {"type":"filter","path":"channel"},{"type":"filter","path":"guests"},
        {"type":"filter","path":"topics"},{"type":"filter","path":"video_id"},
        {"type":"filter","path":"caption_type"},{"type":"filter","path":"upload_ts"},
    ]}))
```

### C. Retrieve → rerank (Python sketch)
```python
def search(query, filters=None, k=8):
    qv = embed_query(query)
    vec = list(chunks.aggregate([
        {"$vectorSearch": {"index":"vector_index","path":"embedding","queryVector":qv,
                            "numCandidates":200,"limit":40, **({"filter":filters} if filters else {})}},
        {"$project":{"_id":0,"text":1,"title":1,"channel":1,"guests":1,
                     "start_sec":1,"deep_link":1,"video_id":1,"score":{"$meta":"vectorSearchScore"}}},
    ]))
    # ... full-text $search + RRF fuse omitted for brevity ...
    rr = vo.rerank(query, [d["text"] for d in vec], model="rerank-2.5", top_k=k)
    return [vec[r.index] | {"rerank": r.relevance_score} for r in rr.results]
```

### D. Grounded-answer system prompt (starting point)
```
You answer questions about the music industry using ONLY the provided transcript excerpts.
Cite every claim inline as [Title @ mm:ss](deep_link). If the excerpts don't contain the answer,
say so — never invent quotes, names, numbers, or sources. Prefer direct, concrete guidance and
attribute who said it (guest/episode) when relevant.
```

### E. Deep-link format
`https://www.youtube.com/watch?v=<video_id>&t=<floor(start_sec)>s`

### F. Source-repo touchpoints (where to look)
- Voyage adapter: `mdb-agent-builder-main/agent_builder/embeddings/adapters.py`
- Hybrid Mongo tool: `mdb-agent-builder-main/agent_builder/tools/mongodb.py`
- ReAct-RAG config: `mdb-agent-builder-main/examples/react_rag_mongodb.yaml`
- Vector-store wiring (to replace): `MongoDB-RAG-Vercel-master/src/utils/openai.ts`
- Chat route (to upgrade): `MongoDB-RAG-Vercel-master/src/app/api/chat/route.ts`
- Ingest reference (to retire): `MongoDB-RAG-Vercel-master/src/app/api/upload/route.ts`

### G. Glossary
**RRF** reciprocal rank fusion · **`input_type`** Voyage query/document optimization flag · **contextualized embedding** chunk vector encoded with whole-document context (`voyage-context-4`) · **deep_link** timestamped YouTube URL · **chunk_uid** `${video_id}:${chunk_index}`.

---

*End of goal document. Build P0 → P8 in order; keep every stage idempotent and resumable; treat citations as a first-class feature.*
