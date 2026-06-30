import { NextResponse } from 'next/server'
import { getMessageById, getThread } from '@/lib/chat-store'

export const runtime = 'nodejs'

type Params = Promise<{ messageId: string }>

function publicError(error: unknown) {
  return error instanceof Error ? error.message : 'regenerate request failed'
}

export async function POST(_req: Request, { params }: { params: Params }) {
  try {
    const { messageId } = await params
    const message = await getMessageById(messageId)
    if (!message) return NextResponse.json({ error: 'message not found' }, { status: 404 })
    if (message.role !== 'assistant') {
      return NextResponse.json({ error: 'only assistant messages can be regenerated' }, { status: 400 })
    }

    const payload = await getThread(message.thread_id)
    if (!payload) return NextResponse.json({ error: 'thread not found' }, { status: 404 })
    const targetIndex = payload.messages.findIndex((item) => item.message_id === messageId)
    const priorUser = payload.messages
      .slice(0, targetIndex)
      .reverse()
      .find((item) => item.role === 'user')
    if (!priorUser) return NextResponse.json({ error: 'prior user message not found' }, { status: 404 })

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'regenerate_prepared',
        route: '/api/messages/[messageId]/regenerate',
        messageId,
        threadId: message.thread_id,
        runId: message.run_id
      })
    )

    return NextResponse.json({
      threadId: message.thread_id,
      question: priorUser.content,
      parentMessageId: message.message_id,
      parentRunId: message.run_id,
      mode: message.mode,
      model: message.model
    })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
