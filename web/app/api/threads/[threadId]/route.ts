import { NextResponse } from 'next/server'
import { getThread, softDeleteThread, updateThread } from '@/lib/chat-store'
import { publicMongoError } from '@/lib/mongodb'

export const runtime = 'nodejs'

type Params = Promise<{ threadId: string }>

function publicError(error: unknown) {
  return publicMongoError(error)
}

function logInfo(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', msg, route: '/api/threads/[threadId]', ...data }))
}

export async function GET(_req: Request, { params }: { params: Params }) {
  try {
    const { threadId } = await params
    const payload = await getThread(threadId)
    if (!payload) return NextResponse.json({ error: 'thread not found' }, { status: 404 })
    logInfo('thread_loaded', { threadId, messageCount: payload.messages.length })
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Params }) {
  try {
    const { threadId } = await params
    const body = (await req.json()) as {
      title?: string
      pinned?: boolean
      archived?: boolean
      project_id?: string | null
    }
    const thread = await updateThread(threadId, body)
    if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 })
    logInfo('thread_updated', { threadId })
    return NextResponse.json({ thread })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Params }) {
  try {
    const { threadId } = await params
    const deleted = await softDeleteThread(threadId)
    if (!deleted) return NextResponse.json({ error: 'thread not found' }, { status: 404 })
    logInfo('thread_deleted', { threadId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
