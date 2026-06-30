import { NextResponse } from 'next/server'
import { upsertFeedback } from '@/lib/chat-store'

export const runtime = 'nodejs'

type Params = Promise<{ messageId: string }>

function publicError(error: unknown) {
  return error instanceof Error ? error.message : 'feedback request failed'
}

export async function POST(req: Request, { params }: { params: Params }) {
  try {
    const { messageId } = await params
    const body = (await req.json()) as {
      rating?: 'up' | 'down'
      reason?: string
      runId?: string
      threadId?: string
      sourceIds?: string[]
      model?: string
    }
    if (body.rating !== 'up' && body.rating !== 'down') {
      return NextResponse.json({ error: 'rating must be up or down' }, { status: 400 })
    }
    const feedback = await upsertFeedback({
      messageId,
      runId: body.runId,
      threadId: body.threadId,
      rating: body.rating,
      reason: body.reason,
      sourceIds: body.sourceIds,
      model: body.model
    })
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'feedback_submitted',
        route: '/api/messages/[messageId]/feedback',
        messageId,
        runId: body.runId,
        rating: body.rating
      })
    )
    return NextResponse.json({ feedback })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
