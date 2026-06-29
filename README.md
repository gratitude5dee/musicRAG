# MusicRAG

MusicRAG vectorizes the local music-industry transcript corpus into MongoDB Atlas for hybrid semantic search and cited RAG.

The full transcript corpus is intentionally not committed. Point the pipeline at the local data with:

```bash
export TRANSCRIPTS_ROOT="../musicindustrytranscripts/transcripts"
```

## Stack

- Python ingestion and retrieval
- MongoDB Atlas Vector Search + Atlas Search
- Voyage embeddings and reranking through MongoDB-native model keys
- Vercel/Next.js UI
- Vercel AI Gateway generation with `google/gemini-3.5-flash`

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with `VOYAGE_API_KEY` and `AI_GATEWAY_API_KEY`, plus either `MONGODB_URI` or the split MongoDB values: `MONGODB_HOST`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, and `MONGODB_OPTIONS`.

## Ingestion

```bash
python -m musicrag.ingest.parse_sources --dry-run
python -m musicrag.ingest.chunk --dry-run --sample 3
python -m musicrag.ingest.run_ingest --resume
```

The pipeline is idempotent. Chunks are keyed by `chunk_uid`, and embeddings are skipped when the stored `content_hash` and 1024-d vector are unchanged.

## Search

```bash
python -m musicrag.query.cli "How do A&R find new artists?"
```

## Evaluation

The retrieval eval set lives at `eval/golden.jsonl` and currently contains 40 questions across all 12 channels.

```bash
python -m musicrag.eval.run_eval
```

The eval writes `eval/report.md` and `eval/report.json`, compares baseline hybrid search with reranked results, and enforces the goal targets: Recall@10 >= 0.85 and MRR@10 >= 0.60.

## Acceptance Audit

Run the local/live readiness audit after secrets are configured:

```bash
python -m musicrag.eval.audit_acceptance
```

This checks local corpus visibility, eval readiness, required env vars, MongoDB connectivity, collection counts, sample embedding dimensions, and search-index queryability.

See [docs/MONGODB_MCP_SETUP.md](docs/MONGODB_MCP_SETUP.md) for Codex MongoDB MCP configuration.

## Web

```bash
cd web
npm install
npm run dev
```

The web app reads from `music_rag.chunks`, `music_rag.channels`, and `music_rag.entities`. It does not ingest or mutate corpus chunks.

## Deployment

The Vercel project is linked from `web/` and deployed at `https://web-iota-neon-52.vercel.app`.

Required production env vars are `MONGODB_HOST`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `MONGODB_DB`, `MONGODB_OPTIONS`, `VOYAGE_API_KEY`, `AI_GATEWAY_API_KEY`, and `GENERATION_MODEL`.

Dynamic API routes also require MongoDB Atlas Network Access for Vercel egress. Use Vercel Secure Compute or another controlled egress option for production, then allow that egress in Atlas. A temporary broad Atlas allow-list can unblock testing, but should not be treated as the production posture.

## GitHub

The intended public repository is `gratitude5dee/musicRAG`. If `gh auth status` reports an invalid token, re-authenticate before creating/pushing:

```bash
gh auth login -h github.com
gh repo create gratitude5dee/musicRAG --public --source . --remote origin --push
```
