import type { AgentTraceEvent, Source } from './types'

const CITATION_RE = /\[([^\]]+)\]/g
const VALID_SOURCE_ID_RE = /^S\d+$/
const NO_INFO_PHRASES = [
  'cannot find',
  "can't find",
  'not found',
  'no information',
  'not present',
  'not available',
  'unable to find',
  'not in the',
  'not contain',
  'does not contain',
  'no results',
  'not enough evidence',
  'the excerpts do not'
]

export type CitationValidation = {
  ok: boolean
  citedSourceIds: string[]
  correction?: string
}

export type AgentSessionState = {
  history: { role: 'user' | 'assistant'; content: string }[]
  retrievedChunkIds: Set<string>
  retrievedTokenCount: number
  trace: AgentTraceEvent[]
  citationRetries: number
}

export function createAgentSession(question: string): AgentSessionState {
  return {
    history: [{ role: 'user', content: question }],
    retrievedChunkIds: new Set(),
    retrievedTokenCount: 0,
    trace: [],
    citationRetries: 0
  }
}

export function estimateTokenCount(text: string) {
  return Math.ceil(text.length / 4)
}

export function appendTrace(state: AgentSessionState, event: AgentTraceEvent) {
  state.trace.push(event)
}

export function recordRetrievedSources(state: AgentSessionState, sources: Source[], label: string) {
  let addedTokens = 0
  for (const source of sources) {
    const id = source.chunk_uid ?? source.id
    if (id) state.retrievedChunkIds.add(id)
    addedTokens += estimateTokenCount(source.snippet ?? '')
  }
  state.retrievedTokenCount += addedTokens
  appendTrace(state, {
    step: 'search_transcripts',
    label,
    count: sources.length,
    token_count: state.retrievedTokenCount
  })
}

export function assignSourceIds(sources: Source[]) {
  return sources.map((source, index) => ({
    ...source,
    id: source.id ?? `S${index + 1}`
  }))
}

export function parseCitedSourceIds(answer: string) {
  const ids = new Set<string>()
  for (const match of answer.matchAll(CITATION_RE)) {
    for (const raw of match[1].split(/[;,]/)) {
      const id = raw.trim()
      if (VALID_SOURCE_ID_RE.test(id)) ids.add(id)
    }
  }
  return [...ids]
}

function containsNoInfoPhrase(answer: string) {
  const lower = answer.toLowerCase()
  return NO_INFO_PHRASES.some((phrase) => lower.includes(phrase))
}

export function validateCitations(answer: string, sources: Source[]): CitationValidation {
  const sourceIds = new Set(sources.map((source) => source.id).filter(Boolean) as string[])
  const citedSourceIds = parseCitedSourceIds(answer)

  if (/https?:\/\//i.test(answer) || /\[[^\]]+\]\(https?:\/\//i.test(answer)) {
    return {
      ok: false,
      citedSourceIds,
      correction:
        'Citation error: do not include raw URLs or markdown links in the answer. Use only source markers like [S1] after claims.'
    }
  }

  if (!citedSourceIds.length) {
    if (!sources.length || containsNoInfoPhrase(answer)) {
      return { ok: true, citedSourceIds: [] }
    }
    return {
      ok: false,
      citedSourceIds: [],
      correction:
        `Your answer has no source markers. Add a valid source marker after every factual claim. Valid source IDs: ${[...sourceIds].join(', ')}.`
    }
  }

  const unknown = citedSourceIds.filter((id) => !sourceIds.has(id))
  if (unknown.length) {
    return {
      ok: false,
      citedSourceIds,
      correction:
        `Citation error: ${unknown.join(', ')} were not retrieved for this answer. Use only valid source IDs: ${[...sourceIds].join(', ')}.`
    }
  }

  return { ok: true, citedSourceIds }
}
