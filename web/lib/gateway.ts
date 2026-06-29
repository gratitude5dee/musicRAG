import type { Source } from './types'
import { streamText } from 'ai'

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

export function gatewayTextStream(question: string, sources: Source[]) {
  const result = streamText({
    model: process.env.GENERATION_MODEL ?? 'google/gemini-3.5-flash',
    temperature: 0.2,
    system:
      'You answer questions about the music industry using ONLY the provided transcript excerpts. Cite every factual claim inline as [Title @ mm:ss](deep_link). If the excerpts do not contain the answer, say so. Never invent quotes, names, numbers, or sources.',
    prompt: buildPrompt(question, sources)
  })
  return result.textStream
}
