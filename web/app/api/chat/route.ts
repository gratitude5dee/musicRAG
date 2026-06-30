import { NextResponse } from 'next/server'
import { gatewayTextStream } from '@/lib/gateway'
import { toSource } from '@/lib/retrieval'
import { runAgent } from '@/lib/agent'
import { assignSourceIds, validateCitations } from '@/lib/rag-harness'
import { createChatRun, newRunId, updateChatRun } from '@/lib/chat-runs'
import type { Filters } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const encoder = new TextEncoder()

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function logInfo(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', msg, ...data }))
}

function logError(msg: string, data: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', msg, ...data }))
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const maybe = error as { message?: unknown; responseBody?: unknown; data?: unknown }
    if (typeof maybe.message === 'string') return maybe.message
    if (typeof maybe.responseBody === 'string') return maybe.responseBody
    if (maybe.data) return JSON.stringify(maybe.data)
  }
  return 'chat failed'
}

function publicError(error: unknown) {
  const message = errorText(error)
  if (
    /MongoServerSelectionError|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|27017/.test(message)
  ) {
    return 'MongoDB Atlas connection timed out from Vercel. Allow Vercel egress in Atlas Network Access, or enable Vercel Secure Compute/static egress and allow that address.'
  }
  if (/positive credit balance|insufficient_funds|Payment Required|402/i.test(message)) {
    return 'Vercel AI Gateway needs a positive credit balance before Gemini can answer. Retrieval is working; add AI Gateway credits in Vercel, then retry.'
  }
  if (/AI Gateway|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|Unauthorized|401|model/i.test(message)) {
    return `Vercel AI Gateway error: ${message}`
  }
  return message
}

async function collectGatewayAnswer(question: string, sources: ReturnType<typeof assignSourceIds>, correction?: string) {
  const result = gatewayTextStream(question, sources, correction)
  let text = ''
  let emittedText = false
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta' && part.text) {
      emittedText = true
      text += part.text
    }
    if (part.type === 'error') {
      throw new Error(publicError(part.error))
    }
  }
  if (!emittedText) {
    throw new Error('Vercel AI Gateway returned no answer text. Check AI Gateway project credits and model access.')
  }
  const usage = await Promise.resolve(result.usage).catch(() => null)
  return { text, usage: usage ?? null }
}

function streamValidatedAnswer(controller: ReadableStreamDefaultController<Uint8Array>, answer: string) {
  const chunks = answer.match(/[\s\S]{1,120}/g) ?? [answer]
  for (const token of chunks) {
    controller.enqueue(sse('token', { token }))
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { question?: string; filters?: Filters }
    const question = body.question?.trim()
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }
    const runId = newRunId()
    const startedAt = Date.now()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(sse('thinking', { label: 'Thinking about your request' }))
          await createChatRun({
            run_id: runId,
            question,
            filters: body.filters ?? {},
            model: process.env.GENERATION_MODEL ?? 'google/gemini-3.5-flash',
            status: 'retrieving'
          })
          logInfo('chat_start', { runId, route: '/api/chat' })

          controller.enqueue(sse('tool', { step: 'search_transcripts', label: 'Searching transcript corpus' }))
          const { plan, docs, trace, session } = await runAgent(question, body.filters)
          const sources = assignSourceIds(docs.map(toSource))
          controller.enqueue(
            sse('meta', {
              runId,
              intent: plan.intent,
              guests: plan.guests,
              channels: plan.channels,
              topics: plan.topics,
              trace
            })
          )
          for (const event of trace) controller.enqueue(sse('tool', event))
          controller.enqueue(sse('sources', sources))
          logInfo('retrieval_done', {
            runId,
            sourceCount: sources.length,
            intent: plan.intent,
            ms: Date.now() - startedAt
          })
          await updateChatRun(runId, {
            status: 'generating',
            intent: plan.intent,
            plan,
            trace,
            source_ids: sources.map((source) => source.id),
            sources: sources.map(({ snippet, ...source }) => ({ ...source, snippet }))
          })

          let correction: string | undefined
          let answer = ''
          let usage: unknown = null
          let citedSourceIds: string[] = []
          for (let attempt = 0; attempt < 4; attempt += 1) {
            if (attempt > 0) {
              session.citationRetries += 1
              controller.enqueue(
                sse('citation_retry', {
                  attempt,
                  correction
                })
              )
              logInfo('citation_retry', { runId, attempt, correction })
            }
            controller.enqueue(sse('tool', { step: 'synthesize', label: attempt ? 'Revising citations' : 'Grounding final answer' }))
            const result = await collectGatewayAnswer(question, sources, correction)
            answer = result.text
            usage = result.usage
            const validation = validateCitations(answer, sources)
            citedSourceIds = validation.citedSourceIds
            controller.enqueue(
              sse('tool', {
                step: 'citation_validation',
                label: validation.ok ? 'citations valid' : 'citations need revision',
                detail: validation.correction
              })
            )
            if (validation.ok) {
              streamValidatedAnswer(controller, answer)
              controller.enqueue(sse('done', { runId, citedSourceIds, trace, usage }))
              await updateChatRun(runId, {
                status: 'complete',
                answer,
                cited_source_ids: citedSourceIds,
                usage,
                citation_retries: session.citationRetries,
                duration_ms: Date.now() - startedAt
              })
              logInfo('chat_done', {
                runId,
                citedSourceCount: citedSourceIds.length,
                citationRetries: session.citationRetries,
                ms: Date.now() - startedAt
              })
              controller.close()
              return
            }
            correction = validation.correction
          }
          throw new Error('Gemini could not produce a citation-valid answer after retrying. Retrieval succeeded; try a narrower question or rerun.')
        } catch (error) {
          const message = publicError(error)
          logError('chat_failed', { runId, error: message, ms: Date.now() - startedAt })
          await updateChatRun(runId, {
            status: 'error',
            error: message,
            duration_ms: Date.now() - startedAt
          })
          controller.enqueue(
            sse('error', { message, runId })
          )
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      }
    })
  } catch (error) {
    return NextResponse.json(
      { error: publicError(error) },
      { status: 500 }
    )
  }
}
