import type { Source } from './types'

export function secondsToMmss(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'no timestamp'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function buildPrompt(question: string, sources: Source[]) {
  const context = sources
    .map(
      (source, index) =>
        `Source ${index + 1}: ${source.title} @ ${secondsToMmss(source.start_sec)}\n` +
        `Channel: ${source.channel}\n` +
        `Guests: ${(source.guests ?? []).join(', ')}\n` +
        `Link: ${source.deep_link ?? ''}\n` +
        `Excerpt: ${source.snippet ?? ''}`
    )
    .join('\n\n---\n\n')

  return `Question: ${question}\n\nTranscript excerpts:\n${context}\n\nAnswer with concise synthesis and inline citations.`
}

export async function gatewayChatStream(question: string, sources: Source[]) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is required')
  }
  return fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.GENERATION_MODEL ?? 'google/gemini-3.5-flash',
      temperature: 0.2,
      stream: true,
      messages: [
        {
          role: 'system',
          content:
            'You answer questions about the music industry using ONLY the provided transcript excerpts. Cite every factual claim inline as [Title @ mm:ss](deep_link). If the excerpts do not contain the answer, say so. Never invent quotes, names, numbers, or sources.'
        },
        { role: 'user', content: buildPrompt(question, sources) }
      ]
    })
  })
}

