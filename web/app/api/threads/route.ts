import { NextResponse } from 'next/server'
import { createThread, listThreads } from '@/lib/chat-store'

export const runtime = 'nodejs'

function logInfo(msg: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ level: 'info', msg, route: '/api/threads', ...data }))
}

function publicError(error: unknown) {
  return error instanceof Error ? error.message : 'thread request failed'
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const sessionId = url.searchParams.get('sessionId')
    const threads = await listThreads(sessionId)
    logInfo('threads_listed', { count: threads.length })
    return NextResponse.json({ threads })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { question?: string; sessionId?: string }
    const thread = await createThread({ question: body.question, sessionId: body.sessionId })
    logInfo('thread_created', { threadId: thread.thread_id })
    return NextResponse.json({ thread }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
