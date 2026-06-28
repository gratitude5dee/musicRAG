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

