import type { Db } from 'mongodb'
import { getDb } from './mongodb'
import { retrieve } from './retrieval'
import { rerankCandidates } from './voyage'
import { appendTrace, createAgentSession, estimateTokenCount, type AgentSessionState } from './rag-harness'
import { diversifyByEpisode, uniqueEpisodeCount } from './ranking'
import type { AgentTraceEvent, Filters } from './types'

// TypeScript port of musicrag.agent (intent routing + context-graph tools +
// CRAG grade + episode-aware rerank). Mirrors the Python pipeline that scored
// Recall@10 0.956 / MRR@10 0.971 on the live golden set. Inferred facets are
// soft (routing/graph only); only explicit `filters` hard-filter $vectorSearch.

export type Intent = 'entity_lookup' | 'thematic' | 'comparative' | 'aggregative'

export type Vocabulary = {
  guests: Map<string, string>
  channels: Map<string, string>
  topics: Map<string, string>
}

export type QueryPlan = {
  intent: Intent
  query: string
  guests: string[]
  channels: string[]
  topics: string[]
  subqueries: string[]
  rationale: string
}

type Doc = Record<string, unknown>

const TOP_K = 8
const SOURCE_LIMIT = 10
const CANDIDATE_LIMIT = 80
const RERANK_WEIGHT = 0.7
const RRF_WEIGHT = 0.3
const EPISODE_DAMP = 0.5
const MAX_RETRIEVED_TOKENS = 8000
const EXPAND_SEEDS = 4
const EXPAND_WINDOW = 1

const COMPARE = [/\bvs\.?\b/, /\bversus\b/, /\bcompared?\b/, /\bdifference between\b/, /\bdiffer\b/, /\bcontrast\b/]
const AGG = [
  /\bcommon (themes?|threads?|advice|lessons?|patterns?)\b/,
  /\bacross (the )?(episodes?|guests?|channels?|interviews?)\b/,
  /\bmost (guests?|people|producers?|managers?|artists?)\b/,
  /\bconsensus\b/,
  /\bevery(one|body)\b/,
  /\brecurring\b/
]

const GENERIC_INDUSTRY_ROLE_TOPICS = new Set([
  'a&r',
  'a & r',
  'artist',
  'artists',
  'manager',
  'managers',
  'producer',
  'producers',
  'songwriter',
  'songwriters',
  'engineer',
  'engineers',
  'publisher',
  'publishers'
])

function canon(text: string) {
  return text
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function matchVocab(text: string, vocab: Map<string, string>) {
  const canonText = canon(text)
  const seen = new Set<string>()
  const found: { len: number; name: string }[] = []
  for (const surface of [...vocab.keys()].sort((a, b) => b.length - a.length)) {
    const cs = canon(surface)
    if (cs.length < 3) continue
    const re = new RegExp(`(?<!\\w)${escapeRegExp(cs)}(?!\\w)`)
    if (re.test(canonText)) {
      const canonical = vocab.get(surface) as string
      if (!seen.has(canonical)) {
        seen.add(canonical)
        found.push({ len: cs.length, name: canonical })
      }
    }
  }
  found.sort((a, b) => b.len - a.len)
  return found.map((f) => f.name)
}

let cachedVocab: Vocabulary | null = null

export async function loadVocabulary(db: Db): Promise<Vocabulary> {
  if (cachedVocab) return cachedVocab
  const guests = new Map<string, string>()
  const topics = new Map<string, string>()
  const channels = new Map<string, string>()
  const ents = await db.collection('entities').find({}, { projection: { name: 1, type: 1 } }).toArray()
  for (const e of ents) {
    const name = e.name as string | undefined
    if (!name) continue
    ;(e.type === 'guest' ? guests : topics).set(name.toLowerCase(), name)
  }
  const chs = await db.collection('channels').find({}, { projection: { channel: 1 } }).toArray()
  for (const c of chs) {
    const name = c.channel as string | undefined
    if (name) channels.set(name.toLowerCase(), name)
  }
  cachedVocab = { guests, channels, topics }
  return cachedVocab
}

export function classifyIntent(query: string, vocab: Vocabulary): QueryPlan {
  const text = ` ${canon(query)} `
  const topicMatches = matchVocab(text, vocab.topics)
  const topicNames = new Set(topicMatches.map((topic) => canon(topic)))
  const guests = matchVocab(text, vocab.guests).filter((guest) => {
    const normalized = canon(guest)
    return !topicNames.has(normalized) && !GENERIC_INDUSTRY_ROLE_TOPICS.has(normalized)
  })
  const channels = matchVocab(text, vocab.channels)
  const topics = topicMatches
  const named = [...guests, ...channels]
  const isCompare = COMPARE.some((r) => r.test(text))
  const isAgg = AGG.some((r) => r.test(text))

  let intent: Intent = 'thematic'
  let subqueries: string[] = []
  let rationale = 'no named guest; conceptual/topic query'
  if (isCompare && named.length >= 2) {
    intent = 'comparative'
    subqueries = named.slice(0, 3).map((e) => `${e}: ${query}`)
    rationale = `comparison cue + ${named.length} named entities`
  } else if (isAgg && guests.length === 0) {
    intent = 'aggregative'
    rationale = 'aggregation cue without a single named guest'
  } else if (guests.length) {
    intent = 'entity_lookup'
    rationale = `named guest(s): ${guests.join(', ')}`
  }
  return { intent, query, guests, channels, topics, subqueries, rationale }
}

// --- context-graph tools ---------------------------------------------------------

const EP_PROJ = { _id: 0, video_id: 1, channel: 1, title: 1, guests: 1, topics: 1 }
const CHUNK_PROJ = {
  _id: 0, chunk_uid: 1, video_id: 1, channel: 1, title: 1, text: 1,
  guests: 1, topics: 1, start_sec: 1, end_sec: 1, deep_link: 1, chunk_index: 1
}

async function findEpisodesByGuest(db: Db, name: string, limit = 5): Promise<Doc[]> {
  const entity = await db.collection('entities').findOne({ type: 'guest', slug: slugify(name) })
  if (entity && Array.isArray(entity.episode_ids) && entity.episode_ids.length) {
    return db.collection('episodes').find({ video_id: { $in: entity.episode_ids } }, { projection: EP_PROJ }).limit(limit).toArray()
  }
  return db
    .collection('episodes')
    .find({ $or: [{ guests: name }, { title: { $regex: escapeRegExp(name), $options: 'i' } }] }, { projection: EP_PROJ })
    .limit(limit)
    .toArray()
}

async function episodeChunks(db: Db, videoId: string, limit = 8): Promise<Doc[]> {
  return db.collection('chunks').find({ video_id: videoId }, { projection: CHUNK_PROJ }).sort({ chunk_index: 1 }).limit(limit).toArray()
}

// --- fusion + episode-aware ranking (mirror Python fuse_and_aggregate) -----------

function normalize(values: number[]) {
  if (!values.length) return []
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (hi - lo < 1e-9) return values.map(() => 1)
  return values.map((v) => (v - lo) / (hi - lo))
}

type Scored = Doc & { combined_score: number; video_score: number }

export function fuseAndAggregate(docs: Doc[], episodeAware = true): Doc[] {
  if (!docs.length) return []
  const rr = normalize(docs.map((d) => Number(d.rerank_score ?? 0)))
  const rf = normalize(docs.map((d) => Number(d.rrf_score ?? 0)))
  const scored: Scored[] = docs.map((d, i) => ({
    ...d,
    combined_score: RERANK_WEIGHT * rr[i] + RRF_WEIGHT * rf[i],
    video_score: 0
  }))
  if (!episodeAware) {
    return [...scored].sort((a, b) => b.combined_score - a.combined_score)
  }
  const byVideo = new Map<unknown, number[]>()
  for (const d of scored) {
    const arr = byVideo.get(d.video_id) ?? []
    arr.push(d.combined_score)
    byVideo.set(d.video_id, arr)
  }
  const videoScore = new Map<unknown, number>()
  for (const [vid, combos] of byVideo) {
    const top = Math.max(...combos)
    videoScore.set(vid, top + EPISODE_DAMP * (combos.reduce((a, b) => a + b, 0) - top))
  }
  for (const d of scored) {
    d.video_score = videoScore.get(d.video_id) ?? d.combined_score
  }
  return [...scored].sort(
    (a, b) => b.video_score - a.video_score || b.combined_score - a.combined_score
  )
}

function dedupe(docs: Doc[]): Doc[] {
  const seen = new Set<unknown>()
  const out: Doc[] = []
  for (const d of docs) {
    const key = d.chunk_uid ?? `${d.video_id}:${d.chunk_index}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}

function docKey(doc: Doc) {
  return doc.chunk_uid ?? `${doc.video_id}:${doc.chunk_index}`
}

function recordDocs(state: AgentSessionState, docs: Doc[], label: string) {
  let addedTokens = 0
  for (const doc of docs) {
    const key = docKey(doc)
    if (key) state.retrievedChunkIds.add(String(key))
    addedTokens += estimateTokenCount(String(doc.text ?? ''))
  }
  state.retrievedTokenCount += addedTokens
  appendTrace(state, {
    step: 'search_transcripts',
    label,
    count: docs.length,
    token_count: state.retrievedTokenCount
  })
}

async function expandContext(db: Db, docs: Doc[], state: AgentSessionState): Promise<Doc[]> {
  if (!docs.length) return docs
  if (state.retrievedTokenCount >= MAX_RETRIEVED_TOKENS) {
    appendTrace(state, {
      step: 'expand_context',
      label: 'skipped: context budget reached',
      token_count: state.retrievedTokenCount
    })
    return docs
  }

  const expanded: Doc[] = [...docs]
  const seen = new Set(docs.map(docKey).map(String))
  let remaining = MAX_RETRIEVED_TOKENS - state.retrievedTokenCount
  let added = 0

  for (const seed of docs.slice(0, EXPAND_SEEDS)) {
    const videoId = typeof seed.video_id === 'string' ? seed.video_id : null
    const chunkIndex = typeof seed.chunk_index === 'number' ? seed.chunk_index : null
    if (!videoId || chunkIndex === null || remaining <= 0) continue
    const neighbors = await db
      .collection('chunks')
      .find(
        {
          video_id: videoId,
          chunk_index: {
            $gte: Math.max(0, chunkIndex - EXPAND_WINDOW),
            $lte: chunkIndex + EXPAND_WINDOW
          }
        },
        { projection: CHUNK_PROJ }
      )
      .sort({ chunk_index: 1 })
      .toArray()

    for (const neighbor of neighbors) {
      const key = String(docKey(neighbor))
      if (seen.has(key)) continue
      const tokens = estimateTokenCount(String(neighbor.text ?? ''))
      if (tokens > remaining) continue
      seen.add(key)
      remaining -= tokens
      added += 1
      state.retrievedChunkIds.add(key)
      expanded.push({
        ...neighbor,
        rerank_score: Number(seed.rerank_score ?? 0) * 0.92,
        rrf_score: Number(seed.rrf_score ?? 0) * 0.92,
        expanded_from: docKey(seed)
      })
    }
  }

  state.retrievedTokenCount = MAX_RETRIEVED_TOKENS - remaining
  appendTrace(state, {
    step: 'expand_context',
    label: added ? `expanded ${added} neighboring chunks` : 'no neighboring chunks added',
    count: added,
    token_count: state.retrievedTokenCount
  })

  return fuseAndAggregate(dedupe(expanded)).slice(0, SOURCE_LIMIT * 2)
}

function diversifyForIntent(intent: Intent, docs: Doc[]) {
  const ranked = dedupe(docs)
  if (intent === 'entity_lookup') {
    return diversifyByEpisode(ranked, SOURCE_LIMIT, { maxPerEpisode: 4, minEpisodes: 2 })
  }
  if (intent === 'comparative') {
    return diversifyByEpisode(ranked, SOURCE_LIMIT, { maxPerEpisode: 2, minEpisodes: 4 })
  }
  return diversifyByEpisode(ranked, SOURCE_LIMIT, { maxPerEpisode: 2, minEpisodes: 5 })
}

function bestPerVideo(docs: Doc[]): Doc[] {
  const seen = new Set<unknown>()
  const out: Doc[] = []
  for (const d of docs) {
    if (seen.has(d.video_id)) continue
    seen.add(d.video_id)
    out.push(d)
  }
  return out
}

function guestAligned(doc: Doc, names: Set<string>) {
  const guests = new Set((Array.isArray(doc.guests) ? doc.guests : []).map((g: unknown) => String(g).toLowerCase()))
  const title = String(doc.title ?? '').toLowerCase()
  for (const n of names) if (guests.has(n) || title.includes(n)) return true
  return false
}

function sufficient(plan: QueryPlan, docs: Doc[]) {
  if (docs.length < 3) return false
  if (plan.guests.length) {
    const names = new Set(plan.guests.map((g) => g.toLowerCase()))
    return docs.slice(0, 5).some((d) => guestAligned(d, names))
  }
  return true
}

// --- routes ----------------------------------------------------------------------

async function routeEntity(db: Db, plan: QueryPlan, filters?: Filters): Promise<Doc[]> {
  const videoIds: string[] = []
  for (const guest of plan.guests.slice(0, 2)) {
    let eps = await findEpisodesByGuest(db, guest)
    if (plan.channels.length) {
      const scoped = eps.filter((e) => plan.channels.includes(String(e.channel)))
      eps = scoped.length ? scoped : eps
    }
    for (const e of eps) if (e.video_id && !videoIds.includes(String(e.video_id))) videoIds.push(String(e.video_id))
  }
  const candidates: Doc[] = []
  for (const vid of videoIds.slice(0, 5)) candidates.push(...(await episodeChunks(db, vid)))
  candidates.push(...(await retrieve(plan.query, filters, CANDIDATE_LIMIT)))
  const scored = await rerankCandidates(plan.query, dedupe(candidates))
  return fuseAndAggregate(scored).slice(0, TOP_K)
}

async function routeThematic(query: string, filters?: Filters): Promise<Doc[]> {
  const fused = await retrieve(query, filters, CANDIDATE_LIMIT)
  const scored = await rerankCandidates(query, fused)
  return diversifyByEpisode(fuseAndAggregate(scored, false), TOP_K, {
    maxPerEpisode: 1,
    minEpisodes: TOP_K
  })
}

async function routeComparative(plan: QueryPlan, filters?: Filters): Promise<Doc[]> {
  const merged: Doc[] = []
  const subs = plan.subqueries.length ? plan.subqueries : [plan.query]
  const perEntity = Math.max(2, Math.floor(TOP_K / subs.length))
  for (const sub of subs) {
    const fused = await retrieve(sub, filters, Math.max(40, Math.floor(CANDIDATE_LIMIT / 2)))
    const scored = await rerankCandidates(sub, fused)
    merged.push(...fuseAndAggregate(scored).slice(0, perEntity))
  }
  return dedupe(merged).slice(0, TOP_K)
}

async function routeAggregative(query: string, filters?: Filters): Promise<Doc[]> {
  const fused = await retrieve(query, filters, Math.max(CANDIDATE_LIMIT, 100))
  const scored = await rerankCandidates(query, fused)
  return bestPerVideo(fuseAndAggregate(scored, false)).slice(0, TOP_K)
}

export type AgentResult = {
  plan: QueryPlan
  docs: Doc[]
  trace: AgentTraceEvent[]
  session: AgentSessionState
}

export async function runAgent(question: string, filters?: Filters): Promise<AgentResult> {
  const db = await getDb()
  const session = createAgentSession(question)
  const vocab = await loadVocabulary(db)
  let plan = classifyIntent(question, vocab)
  appendTrace(session, {
    step: 'classify',
    label: plan.intent,
    detail: plan.rationale
  })

  async function route(p: QueryPlan): Promise<Doc[]> {
    if (p.intent === 'entity_lookup') return routeEntity(db, p, filters)
    if (p.intent === 'comparative') return routeComparative(p, filters)
    if (p.intent === 'aggregative') return routeAggregative(p.query, filters)
    return routeThematic(p.query, filters)
  }

  let docs = await route(plan)
  recordDocs(session, docs, `${plan.intent} route`)
  if (!sufficient(plan, docs)) {
    appendTrace(session, {
      step: 'grade_context',
      label: 'insufficient',
      detail: 'broadened to thematic retrieval',
      count: docs.length
    })
    plan = { ...plan, intent: 'thematic', guests: [], subqueries: [], rationale: 'rewrite: broaden' }
    docs = await route(plan)
    recordDocs(session, docs, 'thematic fallback route')
  } else {
    appendTrace(session, {
      step: 'grade_context',
      label: 'sufficient',
      count: docs.length
    })
  }
  docs = diversifyForIntent(plan.intent, await expandContext(db, docs, session))
  appendTrace(session, {
    step: 'expand_context',
    label: `diversified to ${uniqueEpisodeCount(docs)} episodes`,
    count: docs.length
  })
  appendTrace(session, {
    step: 'synthesize',
    label: 'ready for grounded answer',
    count: docs.length,
    token_count: session.retrievedTokenCount
  })
  return { plan, docs, trace: session.trace, session }
}
