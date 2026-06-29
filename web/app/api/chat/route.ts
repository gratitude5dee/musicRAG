import { NextResponse } from 'next/server'
import { gatewayTextStream } from '@/lib/gateway'
import { toSource } from '@/lib/retrieval'
import { runAgent } from '@/lib/agent'
import type { Filters } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const encoder = new TextEncoder()

function sse(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : 'chat failed'
  if (
    /MongoServerSelectionError|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|27017/.test(message)
  ) {
    return 'MongoDB Atlas connection timed out from Vercel. Allow Vercel egress in Atlas Network Access, or enable Vercel Secure Compute/static egress and allow that address.'
  }
  if (/AI Gateway|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|Unauthorized|401|model/i.test(message)) {
    return `Vercel AI Gateway error: ${message}`
  }
  return message
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { question?: string; filters?: Filters }
    const question = body.question?.trim()
    if (!question) {
      return NextResponse.json({ error: 'question is required' }, { status: 400 })
    }

    // Agentic retrieval: classify -> route (entity/thematic/comparative/aggregative)
    // -> grade -> rewrite. Explicit body.filters hard-filter; inferred facets stay soft.
    const { plan, docs, trace } = await runAgent(question, body.filters)
    const sources = docs.map(toSource)

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          sse('meta', {
            intent: plan.intent,
            guests: plan.guests,
            channels: plan.channels,
            topics: plan.topics,
            trace
          })
        )
        controller.enqueue(sse('sources', sources))
        try {
          const textStream = gatewayTextStream(question, sources)
          for await (const token of textStream) {
            if (token) {
              controller.enqueue(sse('token', { token }))
            }
          }
          controller.enqueue(sse('done', {}))
          controller.close()
        } catch (error) {
          controller.enqueue(
            sse('error', { message: publicError(error) })
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
