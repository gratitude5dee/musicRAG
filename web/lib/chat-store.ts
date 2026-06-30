import type { Document, UpdateFilter } from 'mongodb'
import { getDb } from './mongodb'
import type { ChatMessage, ChatMode, ChatThread, Filters, Source } from './types'

type MessageRole = ChatMessage['role']
type MessageStatus = NonNullable<ChatMessage['status']>

const DEFAULT_SESSION_ID = 'anonymous'

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function cleanText(value: string, fallback: string) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text || fallback
}

function titleFromQuestion(question: string) {
  const title = cleanText(question, 'New MusicRAG chat')
  return title.length > 72 ? `${title.slice(0, 69)}...` : title
}

function serializeDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : value
}

function serializeThread(doc: Record<string, unknown>): ChatThread {
  return {
    thread_id: String(doc.thread_id),
    title: String(doc.title ?? 'New MusicRAG chat'),
    project_id: (doc.project_id as string | null | undefined) ?? null,
    pinned: Boolean(doc.pinned),
    archived: Boolean(doc.archived),
    last_message_at: serializeDate(doc.last_message_at) as string | undefined,
    created_at: serializeDate(doc.created_at) as string | undefined,
    updated_at: serializeDate(doc.updated_at) as string | undefined
  }
}

function serializeMessage(doc: Record<string, unknown>): ChatMessage {
  return {
    message_id: String(doc.message_id),
    thread_id: String(doc.thread_id),
    role: doc.role === 'assistant' ? 'assistant' : 'user',
    content: String(doc.content ?? ''),
    status: doc.status as MessageStatus | undefined,
    model: doc.model as string | undefined,
    mode: doc.mode as ChatMode | undefined,
    run_id: doc.run_id as string | undefined,
    parent_message_id: doc.parent_message_id as string | undefined,
    version: doc.version as number | undefined,
    source_ids: doc.source_ids as string[] | undefined,
    attachment_ids: doc.attachment_ids as string[] | undefined,
    created_at: serializeDate(doc.created_at) as string | undefined,
    updated_at: serializeDate(doc.updated_at) as string | undefined
  }
}

export function normalizeSessionId(sessionId?: string | null) {
  return cleanText(sessionId ?? '', DEFAULT_SESSION_ID).slice(0, 128)
}

export function newThreadId() {
  return id('thread')
}

export function newMessageId() {
  return id('msg')
}

export function newFeedbackId() {
  return id('feedback')
}

export async function createThread({
  question,
  sessionId
}: {
  question?: string
  sessionId?: string | null
}) {
  const now = new Date()
  const thread = {
    thread_id: newThreadId(),
    session_id: normalizeSessionId(sessionId),
    title: question ? titleFromQuestion(question) : 'New MusicRAG chat',
    pinned: false,
    archived: false,
    deleted_at: null,
    last_message_at: now,
    created_at: now,
    updated_at: now
  }
  const db = await getDb()
  await db.collection('chat_threads').insertOne(thread)
  return serializeThread(thread)
}

export async function ensureThread({
  threadId,
  question,
  sessionId
}: {
  threadId?: string | null
  question: string
  sessionId?: string | null
}) {
  const db = await getDb()
  if (threadId) {
    const existing = await db.collection('chat_threads').findOne({
      thread_id: threadId,
      deleted_at: null
    })
    if (existing) {
      const now = new Date()
      await db.collection('chat_threads').updateOne(
        { thread_id: threadId },
        {
          $set: {
            last_message_at: now,
            updated_at: now,
            session_id: existing.session_id ?? normalizeSessionId(sessionId)
          }
        }
      )
      return serializeThread({ ...existing, last_message_at: now, updated_at: now })
    }
  }
  return createThread({ question, sessionId })
}

export async function listThreads(sessionId?: string | null) {
  const db = await getDb()
  const docs = await db
    .collection('chat_threads')
    .find({
      session_id: normalizeSessionId(sessionId),
      deleted_at: null,
      archived: { $ne: true }
    })
    .sort({ pinned: -1, last_message_at: -1 })
    .limit(80)
    .toArray()
  return docs.map(serializeThread)
}

export async function getThread(threadId: string) {
  const db = await getDb()
  const thread = await db.collection('chat_threads').findOne({
    thread_id: threadId,
    deleted_at: null
  })
  if (!thread) return null
  const messages = await db
    .collection('chat_messages')
    .find({ thread_id: threadId })
    .sort({ created_at: 1 })
    .toArray()
  return {
    thread: serializeThread(thread),
    messages: messages.map(serializeMessage)
  }
}

export async function updateThread(
  threadId: string,
  patch: {
    title?: string
    pinned?: boolean
    archived?: boolean
    project_id?: string | null
  }
) {
  const $set: Record<string, unknown> = { updated_at: new Date() }
  if (patch.title !== undefined) $set.title = cleanText(patch.title, 'New MusicRAG chat').slice(0, 120)
  if (patch.pinned !== undefined) $set.pinned = patch.pinned
  if (patch.archived !== undefined) $set.archived = patch.archived
  if (patch.project_id !== undefined) $set.project_id = patch.project_id

  const db = await getDb()
  const result = await db.collection('chat_threads').findOneAndUpdate(
    { thread_id: threadId, deleted_at: null },
    { $set },
    { returnDocument: 'after' }
  )
  return result ? serializeThread(result) : null
}

export async function softDeleteThread(threadId: string) {
  const now = new Date()
  const db = await getDb()
  const result = await db.collection('chat_threads').updateOne(
    { thread_id: threadId, deleted_at: null },
    { $set: { deleted_at: now, updated_at: now } }
  )
  return result.modifiedCount > 0
}

export async function createMessage({
  threadId,
  role,
  content,
  status = 'complete',
  model,
  mode,
  runId,
  parentMessageId,
  sourceIds,
  attachmentIds
}: {
  threadId: string
  role: MessageRole
  content: string
  status?: MessageStatus
  model?: string
  mode?: ChatMode
  runId?: string
  parentMessageId?: string
  sourceIds?: string[]
  attachmentIds?: string[]
}) {
  const now = new Date()
  const message = {
    message_id: newMessageId(),
    thread_id: threadId,
    role,
    content,
    status,
    model,
    mode,
    run_id: runId,
    parent_message_id: parentMessageId,
    version: 1,
    source_ids: sourceIds ?? [],
    attachment_ids: attachmentIds ?? [],
    created_at: now,
    updated_at: now
  }
  const db = await getDb()
  await db.collection('chat_messages').insertOne(message)
  await db.collection('chat_threads').updateOne(
    { thread_id: threadId },
    { $set: { last_message_at: now, updated_at: now } }
  )
  return serializeMessage(message)
}

export async function updateMessage(
  messageId: string,
  patch: {
    content?: string
    status?: MessageStatus
    source_ids?: string[]
    run_id?: string
    model?: string
    mode?: ChatMode
  }
) {
  const db = await getDb()
  const result = await db.collection('chat_messages').findOneAndUpdate(
    { message_id: messageId },
    { $set: { ...patch, updated_at: new Date() } },
    { returnDocument: 'after' }
  )
  return result ? serializeMessage(result) : null
}

export async function getMessageById(messageId: string) {
  const db = await getDb()
  const message = await db.collection('chat_messages').findOne({ message_id: messageId })
  return message ? serializeMessage(message) : null
}

export async function upsertFeedback({
  messageId,
  runId,
  threadId,
  rating,
  reason,
  sourceIds,
  model
}: {
  messageId: string
  runId?: string
  threadId?: string
  rating: 'up' | 'down'
  reason?: string
  sourceIds?: string[]
  model?: string
}) {
  const now = new Date()
  const db = await getDb()
  const update: UpdateFilter<Document> = {
    $set: {
      thread_id: threadId,
      run_id: runId,
      rating,
      reason: reason?.trim() || null,
      source_ids: sourceIds ?? [],
      model,
      updated_at: now
    },
    $setOnInsert: {
      feedback_id: newFeedbackId(),
      message_id: messageId,
      created_at: now
    }
  }
  const result = await db.collection('chat_feedback').findOneAndUpdate(
    { message_id: messageId },
    update,
    { upsert: true, returnDocument: 'after' }
  )
  return result
}

export async function createAttachmentRecord({
  threadId,
  messageId,
  filename,
  contentType,
  sizeBytes,
  blobUrl,
  text,
  status,
  error
}: {
  threadId: string
  messageId?: string
  filename: string
  contentType: string
  sizeBytes: number
  blobUrl?: string
  text?: string
  status: 'uploaded' | 'extracted' | 'error'
  error?: string
}) {
  const now = new Date()
  const doc = {
    attachment_id: id('attach'),
    thread_id: threadId,
    message_id: messageId,
    filename,
    content_type: contentType,
    size_bytes: sizeBytes,
    blob_url: blobUrl,
    text,
    status,
    error,
    created_at: now,
    updated_at: now
  }
  const db = await getDb()
  await db.collection('chat_attachments').insertOne(doc)
  return {
    attachment_id: doc.attachment_id,
    thread_id: doc.thread_id,
    message_id: doc.message_id,
    filename: doc.filename,
    content_type: doc.content_type,
    size_bytes: doc.size_bytes,
    blob_url: doc.blob_url,
    text: doc.text,
    status: doc.status,
    error: doc.error,
    created_at: doc.created_at.toISOString(),
    updated_at: doc.updated_at.toISOString()
  }
}

export function compactSources(sources: Source[]) {
  return sources.map(({ snippet, ...source }) => ({ ...source, snippet }))
}

export function chatRunPatch({
  threadId,
  userMessageId,
  assistantMessageId,
  model,
  mode,
  filters
}: {
  threadId: string
  userMessageId: string
  assistantMessageId: string
  model: string
  mode: ChatMode
  filters?: Filters
}) {
  return {
    thread_id: threadId,
    user_message_id: userMessageId,
    message_id: assistantMessageId,
    model,
    mode,
    filters: filters ?? {}
  }
}
