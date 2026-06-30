# MusicRAG Persistent Chat Workspace Goal

## Summary

MusicRAG should evolve from a single-session transcript RAG chat into a persistent, Grok-inspired research workspace for music industry intelligence. The next phase keeps the current RAG foundation intact: MongoDB Atlas for transcript, retrieval, and chat metadata; Voyage for embeddings and reranking; Vercel AI Gateway for generation; and Vercel Blob for user-uploaded attachment bytes.

This goal document does not replace `docs/MusicRAG-GOAL.md`. It defines the next product layer: persistent threads, projects, history, model modes, citation-first answers, a richer Sources rail, feedback, regeneration, attachments, and production observability.

## Product Experience

### App Shell

- Keep the brand as MusicRAG.
- Redesign the first viewport around a focused black chat workspace inspired by the provided references:
  - Left sidebar with MusicRAG mark, Search, New Chat, Projects, History, pinned chats, and account/footer area.
  - Centered conversation canvas with right-aligned user prompt pills and rich markdown assistant responses.
  - Fixed pill composer at the bottom with attach, prompt input, model/mode selector, microphone affordance, and send/stop button.
  - Top-right utility actions for share/copy link, new chat, thread menu, and Sources visibility.
  - Right Sources rail that can be closed and reopened.
  - Mobile behavior uses drawers/sheets for sidebar and sources instead of cramming three columns onto the screen.

### New Chat Landing

- `/` opens a polished new-chat state rather than an empty transcript screen.
- The landing view shows the MusicRAG identity, a centered composer, current model mode, and a small set of starter prompts for common music industry workflows.
- Submitting the first message creates a thread, redirects or hydrates into `/chat/[threadId]`, and starts streaming the first answer.

### Sources Rail

- The Sources rail shows the agent trace and retrieved transcript evidence:
  - Thinking about your request.
  - Searching transcript corpus.
  - Expanding neighboring transcript context.
  - Reranking evidence.
  - Verifying citations.
- Source cards show source ID, title, channel, timestamp range, snippet, score, and an Open timestamp action.
- YouTube deep links and transcript timestamps appear only in the Sources UI, never as markdown links inside the answer body.

### Citation UX

- Gemini may emit citation markers like `[S1]`, `[S2]`, and `[S3]`.
- The client renderer turns those markers into inline citation chips or hovercards.
- Raw citation syntax should never appear as plain text after rendering.
- The assistant answer must not include URLs or markdown source links.
- Every factual claim that depends on retrieved transcript context should include at least one valid citation chip.

### Human Feedback And Actions

- Assistant responses include lightweight actions:
  - Copy answer.
  - Share/copy thread link.
  - Thumbs up.
  - Thumbs down with optional reason.
  - Regenerate response.
  - Open Sources.
- Feedback is optimistic in the UI, persisted server-side, and tied to the assistant message, run ID, selected model, citations, and sources.
- A user/session can update feedback on an answer, but duplicate feedback rows should be avoided.

### Regeneration

- Regenerate creates a new assistant message version and a new `chat_runs` record.
- Regeneration does not overwrite the prior answer.
- The new run records `parent_run_id`, `parent_message_id`, selected model, filters, attachments used, retrieved sources, and citation validation result.
- The UI should make the latest version primary while preserving access to prior versions when practical.

### Attachments

- The composer plus button supports user-uploaded context files.
- V1 accepted file types:
  - `.txt`
  - `.md`
  - `.csv`
  - `.json`
  - `.pdf`
- Limits:
  - 5 files per message.
  - 10 MB per file.
  - Server rejects unsupported types and oversize uploads before extraction.
- Store file bytes in Vercel Blob.
- Store metadata and extracted text in MongoDB.
- Attachment text is thread-scoped supplemental context. It must not mutate the global transcript vector database or public corpus.
- If an answer uses attachment evidence, the UI should distinguish attachment sources from transcript sources.

## Architecture

### Persistence Choice

Use MongoDB only for this phase. Supabase Auth/Postgres/Storage are intentionally out of scope unless a later account/auth phase is requested.

MongoDB remains the source of truth for:

- Transcript and chunk collections.
- Retrieval metadata.
- Chat threads.
- Chat messages.
- Generation runs.
- Feedback.
- Projects.
- Attachment metadata and extracted text.

Vercel Blob stores only uploaded file bytes.

### MongoDB Collections

Add or formalize these collections:

- `chat_threads`
  - `thread_id`
  - `title`
  - `project_id`
  - `pinned`
  - `archived`
  - `deleted_at`
  - `last_message_at`
  - `created_at`
  - `updated_at`
  - anonymous/session identity fields when auth is absent
- `chat_messages`
  - `message_id`
  - `thread_id`
  - `role`
  - `content`
  - `status`
  - `model`
  - `mode`
  - `run_id`
  - `parent_message_id`
  - `version`
  - `source_ids`
  - `attachment_ids`
  - `created_at`
  - `updated_at`
- `chat_runs`
  - Keep the current run persistence and extend it with `thread_id`, `message_id`, `parent_run_id`, `mode`, selected `model`, source IDs, trace, citation retries, usage, estimated cost when available, status, error, and duration.
- `chat_feedback`
  - `feedback_id`
  - `thread_id`
  - `message_id`
  - `run_id`
  - `rating`
  - `reason`
  - `source_ids`
  - `model`
  - `created_at`
  - `updated_at`
- `chat_attachments`
  - `attachment_id`
  - `thread_id`
  - `message_id`
  - `filename`
  - `content_type`
  - `size_bytes`
  - `blob_url`
  - `text`
  - `status`
  - `error`
  - `created_at`
- `chat_projects`
  - `project_id`
  - `name`
  - `description`
  - `created_at`
  - `updated_at`

### Indexing

Add standard indexes for chat workspace speed and integrity:

- `chat_threads`: `thread_id` unique, `last_message_at`, `project_id`, `pinned`, `deleted_at`.
- `chat_messages`: `message_id` unique, `thread_id + created_at`, `run_id`.
- `chat_runs`: `run_id` unique, `thread_id + created_at`, `status`, `model`.
- `chat_feedback`: `feedback_id` unique, `message_id`, `run_id`.
- `chat_attachments`: `attachment_id` unique, `thread_id`, `message_id`, `status`.
- `chat_projects`: `project_id` unique, `updated_at`.

### Route And Page Interfaces

Add persistent chat pages:

- `GET /`
  - New chat landing.
- `GET /chat/[threadId]`
  - Loads a persisted thread, messages, latest source state, and project/sidebar context.

Add or update API routes:

- `GET /api/models`
  - Returns supported chat modes and server-approved AI Gateway model IDs.
- `GET /api/threads`
  - Returns history grouped by recency and project.
- `POST /api/threads`
  - Creates a blank thread or first-message thread.
- `GET /api/threads/[threadId]`
  - Returns thread metadata and messages.
- `PATCH /api/threads/[threadId]`
  - Renames, pins, archives, moves to project, or updates title.
- `DELETE /api/threads/[threadId]`
  - Soft deletes the thread.
- `POST /api/chat`
  - Requires or creates `threadId`, creates user and assistant message records, creates the generation run before model generation, streams agent events, and persists completion or error.
- `POST /api/messages/[messageId]/feedback`
  - Upserts thumbs up/down feedback.
- `POST /api/messages/[messageId]/regenerate`
  - Creates a new generation run and assistant message version from the same user prompt and current selected mode/model.
- `POST /api/attachments`
  - Uploads and extracts user files, stores bytes in Vercel Blob, stores metadata/text in MongoDB.

### Streaming Events

Keep the existing deterministic SSE style and extend it as needed:

- `meta`
- `thinking`
- `tool`
- `sources`
- `token`
- `citation_retry`
- `message`
- `usage`
- `done`
- `error`

The stream should expose sources before final answer tokens whenever retrieval succeeds, so the user can inspect evidence even if Gateway generation fails due to credits, rate limits, or model access.

### AI Gateway Models

Generation must continue through Vercel AI Gateway only.

Default modes:

- `Fast`
  - Default model: `google/gemini-3.5-flash`.
  - Optimized for fast transcript-grounded answers.
- `Expert`
  - Uses `AI_GATEWAY_MODEL_ALLOWLIST`.
  - The server chooses the default expert model from `EXPERT_GENERATION_MODEL` when present.
  - If no expert env var is configured, fall back to `google/gemini-3.5-flash`.

Rules:

- Never trust arbitrary model IDs from the client.
- `GET /api/models` exposes only server-approved options.
- `POST /api/chat` validates the requested model and mode.
- Store mode, model, provider usage, and Gateway error class on every run.
- Use Gateway user/tags metadata when supported:
  - `feature:musicrag-chat`
  - `mode:fast` or `mode:expert`
  - `env:production` or `env:preview`

### Vercel Function Runtime

- Use Node.js route handlers for chat, thread persistence, attachments, and MongoDB access.
- Keep AI streaming as a streaming response.
- Configure function duration high enough for retrieval plus generation.
- Use background work for non-blocking telemetry, title generation, and analytics where appropriate.
- Avoid Edge runtime for routes that need MongoDB driver, file parsing, or Blob upload work.

## RAG Behavior

### Retrieval

Keep the current MusicRAG strengths:

- MongoDB Atlas vector search.
- Atlas full-text search.
- RRF fusion.
- Voyage rerank.
- Neighbor chunk expansion.
- Episode-aware ranking.
- Agent trace events.
- Citation validation and retries.

Extend retrieval context with:

- Current thread history summary or last relevant turns.
- Thread-scoped attachments when selected or recently uploaded.
- User-selected filters for channel, guest, topic, and date.

### Prompt Contract

The system prompt must require:

- Use only provided transcript excerpts, attachment excerpts, and conversation context.
- Cite factual transcript claims with valid `[S#]` markers.
- Cite attachment evidence with valid attachment source markers if attachment evidence is used.
- Do not emit URLs or markdown links.
- Do not cite unknown source IDs.
- Say when evidence is missing instead of guessing.
- Prefer concise, actionable music industry guidance grounded in the retrieved sources.

### Citation Validation

Before a streamed completion is marked complete:

- Parse cited IDs from the answer.
- Reject unknown source IDs.
- Trigger citation repair if the answer makes factual claims with no citations.
- Allow a grounded "not found" answer with no citations only when the answer clearly says the corpus does not provide enough evidence.
- Retry citation repair up to the existing retry limit.

## Observability

### Structured Logs

Every route should log JSON with:

- `level`
- `msg`
- `route`
- `requestId`
- `threadId`
- `messageId`
- `runId`
- `model`
- `mode`
- `ms`
- `status`
- `error` when present

Important events:

- Thread created, loaded, updated, deleted.
- Message persisted.
- Retrieval started/completed.
- Source count and rerank count.
- Neighbor expansion count.
- Citation retry.
- Gateway generation started/completed.
- Gateway credit/rate/model errors.
- Feedback submitted.
- Regeneration started/completed.
- Attachment uploaded/extracted/rejected.

### Analytics And Speed

- Add Vercel Web Analytics for page and feature usage.
- Add Speed Insights to watch Core Web Vitals after the heavier workspace shell lands.
- Track custom events where available:
  - `chat_submitted`
  - `model_selected`
  - `source_opened`
  - `feedback_submitted`
  - `response_regenerated`
  - `attachment_uploaded`

### Error Handling

- Preserve the current clear AI Gateway credit/access error behavior.
- Chat errors should still leave retrieved sources visible when retrieval succeeded.
- Attachment errors should be per-file and should not wipe the composer state.
- Thread load failures should show a recoverable empty/error state with a New Chat action.

## UI Implementation Notes

- Keep Geist typography.
- Prefer existing AI Elements components and add only the necessary shadcn-style primitives:
  - Button
  - Dropdown menu
  - Dialog or sheet
  - Tooltip
  - Separator
  - Badge
- Use lucide icons for toolbar and action affordances.
- Avoid nested cards and decorative gradients.
- Keep the chat surface quiet, dense, and readable.
- Buttons should use icons where the meaning is familiar, with tooltips for less obvious actions.
- The answer body should remain readable at long-form lengths and should not be constrained by the Sources rail on mobile.

## Test Plan

### Unit Tests

- Model allowlist validation rejects unknown client-supplied model IDs.
- Thread/message persistence creates stable IDs before generation starts.
- Citation renderer converts `[S#]` markers into UI chips and hides raw markdown links.
- Feedback upsert avoids duplicate rows for the same answer/session.
- Regeneration creates a new run and assistant message version with `parent_run_id`.
- Attachment validation rejects unsupported file types and files larger than 10 MB.
- Attachment extraction returns text for `.txt`, `.md`, `.csv`, `.json`, and `.pdf`.
- MongoDB schema/index helpers emit expected definitions.

### Integration Tests

- `POST /api/chat` creates or accepts a `threadId`, persists a user message, creates a pending assistant message/run, streams sources before answer tokens, and marks the run complete on success.
- Gateway failure after retrieval still returns visible source cards and persists an error run.
- `/chat/[threadId]` reloads persisted messages and the latest answer state after refresh.
- Feedback route persists thumbs up/down and updates existing feedback.
- Regenerate route creates a new run without overwriting the previous answer.
- Attachment route stores bytes in Blob and metadata/text in MongoDB.

### UI Smoke Tests

- Desktop: sidebar, new chat, history selection, project list, top action menu, source rail close/open, answer actions, and fixed composer all render without overlap.
- Mobile: sidebar and sources use drawers; composer remains usable; citations and source cards remain tappable.
- New chat landing starts a thread and moves into the persistent chat view.
- Expert/Fast selector changes model mode and persists the selected mode per run.
- Thumbs, copy, share, and regenerate actions provide visible feedback.

### Build And Deployment Checks

- Run `cd web && npm run build`.
- Run unit tests for web and any touched shared helpers.
- Deploy a Vercel preview.
- Scan Vercel runtime logs after deployment for early function errors.
- Promote to production only after preview chat, thread reload, sources, feedback, and regenerate pass smoke testing.

## Acceptance Criteria

- A user can create a new chat, ask a question, refresh the page, and see the same thread and answer at `/chat/[threadId]`.
- A user can start multiple threads and reopen them from History.
- A user can pin, rename, move, and soft-delete a thread.
- A user can choose Fast or Expert mode from server-approved AI Gateway models.
- Answers stream with UI citation chips and never show source URLs in answer prose.
- Sources rail remains useful even when Gateway generation fails.
- A user can thumbs up/down an answer and regenerate it.
- A user can attach supported files, use them as thread-local context, and keep them out of the global transcript vector database.
- Every generation has a persisted run record with model, mode, source IDs, status, trace, and usage when available.
- Production logs provide enough structure to debug retrieval, generation, citations, feedback, attachments, and thread persistence.

## Assumptions

- MongoDB remains the only database for this phase.
- Supabase Auth/Postgres/Storage are not implemented in this phase.
- Vercel Blob is available for attachment bytes.
- Generation continues through Vercel AI Gateway only.
- The default model remains `google/gemini-3.5-flash`.
- Attachments are private per thread/session and are not ingested into the public transcript semantic search index.
- No direct OpenAI, Anthropic, or provider-specific generation keys are required.
