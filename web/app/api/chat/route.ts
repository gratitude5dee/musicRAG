import { NextResponse } from 'next/server'
import { gatewayTextStream } from '@/lib/gateway'
import { publicMongoError } from '@/lib/mongodb'
import { toSource } from '@/lib/retrieval'
import { runAgent } from '@/lib/agent'
import { assignSourceIds, validateCitations } from '@/lib/rag-harness'
import { createChatRun, newRunId, updateChatRun } from '@/lib/chat-runs'
import {
  chatRunPatch,
  compactSources,
  createMessage,
  ensureThread,
  updateMessage
} from '@/lib/chat-store'
import { validateModelSelection } from '@/lib/models'
import type { ChatMode, Filters } from '@/lib/types'

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
    return publicMongoError(error)
  }
  if (/positive credit balance|insufficient_funds|Payment Required|402/i.test(message)) {
    return 'Vercel AI Gateway needs a positive credit balance before Gemini can answer. Retrieval is working; add AI Gateway credits in Vercel, then retry.'
  }
  if (/AI Gateway|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|Unauthorized|401|model/i.test(message)) {
    return `Vercel AI Gateway error: ${message}`
  }
  return message
}

async function collectGatewayAnswer(
  question: string,
  sources: ReturnType<typeof assignSourceIds>,
  model: string,
  correction?: string
) {
  const result = gatewayTextStream(question, sources, correction, model)
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
    const body = (await req.json()) as {
      question?: string
      filters?: Filters
      threadId?: string
      sessionId?: string
      mode?: ChatMode
      model?: string
      parentRunId?: string
      parentMessageId?: string
    }
    const question = body.question?.trim()
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }
    const selection = validateModelSelection({ mode: body.mode, model: body.model })
    const runId = newRunId()
    const startedAt = Date.now()

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let assistantMessageId: string | null = null
        try {
          controller.enqueue(sse('thinking', { label: 'Thinking about your request' }))
          const thread = await ensureThread({
            threadId: body.threadId,
            question,
            sessionId: body.sessionId
          })
          const userMessage = await createMessage({
            threadId: thread.thread_id,
            role: 'user',
            content: question,
            status: 'complete'
          })
          const assistantMessage = await createMessage({
            threadId: thread.thread_id,
            role: 'assistant',
            content: '',
            status: 'streaming',
            model: selection.model,
            mode: selection.mode,
            runId,
            parentMessageId: body.parentMessageId
          })
          assistantMessageId = assistantMessage.message_id
          controller.enqueue(
            sse('meta', {
              runId,
              threadId: thread.thread_id,
              userMessageId: userMessage.message_id,
              assistantMessageId: assistantMessage.message_id,
              model: selection.model,
              mode: selection.mode
            })
          )
          await createChatRun({
            run_id: runId,
            question,
            ...chatRunPatch({
              threadId: thread.thread_id,
              userMessageId: userMessage.message_id,
              assistantMessageId: assistantMessage.message_id,
              model: selection.model,
              mode: selection.mode,
              filters: body.filters
            }),
            parent_run_id: body.parentRunId,
            parent_message_id: body.parentMessageId,
            status: 'retrieving'
          })
          logInfo('chat_start', {
            runId,
            threadId: thread.thread_id,
            model: selection.model,
            mode: selection.mode,
            route: '/api/chat'
          })

          controller.enqueue(sse('tool', { step: 'search_transcripts', label: 'Searching transcript corpus' }))
          const { plan, docs, trace, session } = await runAgent(question, body.filters)
          const sources = assignSourceIds(docs.map(toSource))
          controller.enqueue(
            sse('meta', {
              runId,
              threadId: thread.thread_id,
              userMessageId: userMessage.message_id,
              assistantMessageId: assistantMessage.message_id,
              model: selection.model,
              mode: selection.mode,
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
            threadId: thread.thread_id,
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
            sources: compactSources(sources)
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
            const result = await collectGatewayAnswer(question, sources, selection.model, correction)
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
              await updateMessage(assistantMessage.message_id, {
                status: 'complete',
                content: answer,
                source_ids: sources.map((source) => source.id).filter(Boolean) as string[],
                run_id: runId,
                model: selection.model,
                mode: selection.mode
              })
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
                threadId: thread.thread_id,
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
          if (assistantMessageId) {
            await updateMessage(assistantMessageId, {
              status: 'error',
              content: `Error: ${message}`,
              run_id: runId,
              model: selection.model,
              mode: selection.mode
            })
          }
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
    const maybeStatus = error instanceof Error && 'status' in error ? Number(error.status) : 500
    return NextResponse.json(
      { error: publicError(error) },
      { status: Number.isFinite(maybeStatus) ? maybeStatus : 500 }
    )
  }
}
