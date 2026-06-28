import { NextResponse } from 'next/server'
import { gatewayChatStream } from '@/lib/gateway'
import { retrieve, toSource } from '@/lib/retrieval'
import { rerank } from '@/lib/voyage'
import type { Filters } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const encoder = new TextEncoder()

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { question?: string; filters?: Filters }
    const question = body.question?.trim()
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }

    const retrieved = await retrieve(question, body.filters)
    const reranked = await rerank(question, retrieved, 8)
    const sources = reranked.map(toSource)
    const gateway = await gatewayChatStream(question, sources)
    if (!gateway.ok || !gateway.body) {
      const detail = await gateway.text().catch(() => '')
      return NextResponse.json({ error: `AI Gateway failed: ${gateway.status}`, detail }, { status: 502 })
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sse('sources', sources))
        const reader = gateway.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed.startsWith('data:')) continue
              const raw = trimmed.slice(5).trim()
              if (!raw || raw === '[DONE]') continue
              try {
                const payload = JSON.parse(raw)
                const token = payload.choices?.[0]?.delta?.content ?? ''
                if (token) controller.enqueue(sse('token', { token }))
              } catch {
                // Ignore keep-alive or provider-specific non-JSON fragments.
              }
            }
          }
          controller.enqueue(sse('done', {}))
          controller.close()
        } catch (error) {
          controller.enqueue(sse('error', { message: error instanceof Error ? error.message : 'stream failed' }))
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
      { error: error instanceof Error ? error.message : 'chat failed' },
      { status: 500 }
    )
  }
}

