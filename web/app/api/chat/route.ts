import { NextResponse } from 'next/server'
import { gatewayTextStream } from '@/lib/gateway'
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
    const textStream = gatewayTextStream(question, sources)

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sse('sources', sources))
        try {
          for await (const token of textStream) {
            if (token) {
              controller.enqueue(sse('token', { token }))
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
