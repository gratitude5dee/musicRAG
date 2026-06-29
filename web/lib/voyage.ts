const MONGODB_AI_BASE_URL = 'https://ai.mongodb.com/v1'

type EmbeddingResponse = {
  data?: { embedding: number[] }[]
  embeddings?: number[][]
}

type RerankResponse = {
  data?: { index: number; relevance_score?: number; score?: number }[]
  results?: { index: number; relevance_score?: number; score?: number }[]
}

export async function embedQuery(query: string) {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error('VOYAGE_API_KEY is required')
  }
  const model =
    process.env.EMBED_MODEL === 'voyage-context-4'
      ? process.env.EMBED_FALLBACK_MODEL ?? 'voyage-4-large'
      : process.env.EMBED_MODEL ?? 'voyage-4-large'
  const response = await fetch(`${MONGODB_AI_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, input: [query], input_type: 'query' })
  })
  if (!response.ok) {
    throw new Error(`Voyage embedding failed: ${response.status}`)
  }
  const payload = (await response.json()) as EmbeddingResponse
  const embedding = payload.data?.[0]?.embedding ?? payload.embeddings?.[0]
  if (!embedding || embedding.length !== 1024) {
    throw new Error(`Voyage embedding returned ${embedding?.length ?? 0} dims; expected 1024`)
  }
  return embedding
}

// Give the cross-encoder who/where context, mirroring musicrag.query.rerank.
export function formatForRerank(doc: Record<string, unknown>) {
  const title = String(doc.title ?? 'Untitled')
  const guests = Array.isArray(doc.guests) ? doc.guests.join(', ') : ''
  const channel = String(doc.channel ?? '')
  let header = `[${title}`
  if (guests) header += ` — ${guests}`
  header += channel ? ` · ${channel}]` : ']'
  return `${header}\n${String(doc.text ?? '')}`
}

// Score ALL candidates (rich input) so the agent can fuse + episode-aggregate.
export async function rerankCandidates(query: string, docs: Record<string, unknown>[]) {
  if (!docs.length) return []
  if (!process.env.VOYAGE_API_KEY) {
    return docs.map((d) => ({ ...d, rerank_score: Number(d.rrf_score ?? d.score ?? 0) }))
  }
  const response = await fetch(`${MONGODB_AI_BASE_URL}/rerank`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.RERANK_MODEL ?? 'rerank-2.5',
      query,
      documents: docs.map(formatForRerank)
    })
  })
  if (!response.ok) {
    return docs.map((d) => ({ ...d, rerank_score: Number(d.rrf_score ?? 0) }))
  }
  const payload = (await response.json()) as RerankResponse
  const results = payload.results ?? payload.data ?? []
  return results.map((result) => ({
    ...docs[result.index],
    rerank_score: result.relevance_score ?? result.score ?? 0
  }))
}

export async function rerank(query: string, docs: Record<string, unknown>[], topK = 8) {
  if (!docs.length) return []
  if (!process.env.VOYAGE_API_KEY) {
    return docs.slice(0, topK)
  }
  const response = await fetch(`${MONGODB_AI_BASE_URL}/rerank`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.RERANK_MODEL ?? 'rerank-2.5',
      query,
      documents: docs.map((doc) => String(doc.text ?? '')),
      top_k: Math.min(topK, docs.length)
    })
  })
  if (!response.ok) {
    return docs.slice(0, topK)
  }
  const payload = (await response.json()) as RerankResponse
  const results = payload.results ?? payload.data ?? []
  return results.map((result) => ({
    ...docs[result.index],
    rerank_score: result.relevance_score ?? result.score ?? null
  }))
}

