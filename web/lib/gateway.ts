import type { Source } from './types'
import { streamText } from 'ai'

export function secondsToMmss(seconds?: number | null) {
  if (seconds === null || seconds === undefined) return 'no timestamp'
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export function buildPrompt(question: string, sources: Source[], correction?: string) {
  const context = sources
    .map(
      (source, index) =>
        `Source ID: ${source.id ?? `S${index + 1}`}\n` +
        `Title: ${source.title} @ ${secondsToMmss(source.start_sec)}\n` +
        `Channel: ${source.channel}\n` +
        `Guests: ${(source.guests ?? []).join(', ')}\n` +
        `Excerpt: ${source.snippet ?? ''}`
    )
    .join('\n\n---\n\n')

  const repair = correction
    ? `\n\nCitation repair instruction from validator:\n${correction}\nRevise the answer so it obeys this instruction.`
    : ''

  return `Question: ${question}\n\nTranscript excerpts:\n${context}${repair}\n\nAnswer with concise synthesis and valid source markers.`
}

export function gatewayTextStream(question: string, sources: Source[], correction?: string, model?: string) {
  return streamText({
    model: model ?? process.env.GENERATION_MODEL ?? 'google/gemini-3.5-flash',
    temperature: 0.2,
    system:
      [
        'You are MusicRAG, a careful music-industry research assistant.',
        'Use ONLY the provided transcript excerpts. Never invent quotes, names, numbers, channels, episodes, or sources.',
        'Cite every factual claim with source markers like [S1] or [S1] [S2].',
        'Only use source IDs that appear in the provided excerpts. Do not cite titles, timestamps, chunk IDs, or URLs in the answer text.',
        'Never output raw URLs or markdown links. Citation links are handled by the UI.',
        'If the excerpts do not support an answer, say what is missing and avoid unsupported claims.',
        'Prefer a strong thesis, short sections, practical bullets, and grounded music-industry language.'
      ].join(' '),
    prompt: buildPrompt(question, sources, correction)
  })
}
