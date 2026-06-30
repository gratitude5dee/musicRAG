import type { Collection, Document } from 'mongodb'
import { getDb } from './mongodb'
import { embedQuery } from './voyage'
import type { Filters, Source } from './types'

const sourceProjection = {
  _id: 0,
  chunk_uid: 1,
  video_id: 1,
  channel: 1,
  title: 1,
  text: 1,
  guests: 1,
  topics: 1,
  start_sec: 1,
  end_sec: 1,
  deep_link: 1,
  chunk_index: 1
}

const DEFAULT_LIMIT = 80
const MIN_NUM_CANDIDATES = 800
const MAX_NUM_CANDIDATES = 10000

function compactFilters(filters?: Filters) {
  const clauses: Document[] = []
  if (filters?.channel) clauses.push({ channel: filters.channel })
  if (filters?.guest) clauses.push({ guests: { $eq: filters.guest } })
  if (filters?.topic) clauses.push({ topics: { $eq: filters.topic } })
  if (filters?.date_from_ts || filters?.date_to_ts) {
    const range: Document = {}
    if (filters.date_from_ts) range.$gte = filters.date_from_ts
    if (filters.date_to_ts) range.$lte = filters.date_to_ts
    clauses.push({ upload_ts: range })
  }
  if (clauses.length === 0) return undefined
  if (clauses.length === 1) return clauses[0]
  return { $and: clauses }
}

async function vectorSearch(collection: Collection, queryVector: number[], filters?: Filters, limit = DEFAULT_LIMIT) {
  const numCandidates = Math.min(MAX_NUM_CANDIDATES, Math.max(MIN_NUM_CANDIDATES, limit * 20))
  const stage: Document = {
    index: 'vector_index',
    path: 'embedding',
    queryVector,
    numCandidates,
    limit
  }
  const vectorFilter = compactFilters(filters)
  if (vectorFilter) stage.filter = vectorFilter
  return collection
    .aggregate([
      { $vectorSearch: stage },
      { $project: { ...sourceProjection, score: { $meta: 'vectorSearchScore' } } }
    ])
    .toArray()
}

async function fullTextSearch(collection: Collection, query: string, filters?: Filters, limit = DEFAULT_LIMIT) {
  const pipeline: Document[] = [
    {
      $search: {
        index: 'text_index',
        text: { query, path: ['text', 'title', 'guests', 'topics'] }
      }
    }
  ]
  const match = compactFilters(filters)
  if (match) pipeline.push({ $match: match })
  pipeline.push(
    { $limit: limit },
    { $project: { ...sourceProjection, score: { $meta: 'searchScore' } } }
  )
  return collection.aggregate(pipeline).toArray()
}

function rrf(vector: Document[], text: Document[], filters?: Filters) {
  const fused = new Map<string, Document>()
  for (const [name, results, weight] of [
    ['vector', vector, 1],
    ['text', text, 0.85]
  ] as const) {
    results.forEach((doc, index) => {
      const key = String(doc.chunk_uid)
      const existing = fused.get(key) ?? { ...doc, rrf_score: 0, signals: {} }
      existing.rrf_score += weight * (1 / (60 + index + 1))
      existing.signals[name] = { rank: index + 1, score: doc.score }
      fused.set(key, existing)
    })
  }
  for (const doc of fused.values()) {
    if (filters?.guest && Array.isArray(doc.guests) && doc.guests.includes(filters.guest)) {
      doc.rrf_score += 0.01
    }
    if (filters?.topic && Array.isArray(doc.topics) && doc.topics.includes(filters.topic)) {
      doc.rrf_score += 0.01
    }
  }
  return Array.from(fused.values()).sort((a, b) => Number(b.rrf_score ?? 0) - Number(a.rrf_score ?? 0))
}

export function toSource(doc: Document): Source {
  const text = String(doc.text ?? '')
  return {
    chunk_uid: typeof doc.chunk_uid === 'string' ? doc.chunk_uid : undefined,
    title: String(doc.title ?? ''),
    channel: String(doc.channel ?? ''),
    guests: Array.isArray(doc.guests) ? doc.guests.map(String) : [],
    video_id: String(doc.video_id ?? ''),
    start_sec: typeof doc.start_sec === 'number' ? doc.start_sec : null,
    end_sec: typeof doc.end_sec === 'number' ? doc.end_sec : null,
    deep_link: typeof doc.deep_link === 'string' ? doc.deep_link : null,
    snippet: text.length > 520 ? `${text.slice(0, 517).trim()}...` : text,
    score: Number(doc.rerank_score ?? doc.rrf_score ?? doc.score ?? 0),
    chunk_index: typeof doc.chunk_index === 'number' ? doc.chunk_index : null
  }
}

export async function retrieve(query: string, filters?: Filters, limit = DEFAULT_LIMIT) {
  const db = await getDb()
  const collection = db.collection('chunks')
  const queryVector = await embedQuery(query)
  const [vector, text] = await Promise.all([
    vectorSearch(collection, queryVector, filters, limit),
    fullTextSearch(collection, query, filters, limit)
  ])
  return rrf(vector, text, filters).slice(0, limit)
}
