import { put } from '@vercel/blob'
import { PDFParse } from 'pdf-parse'
import { NextResponse } from 'next/server'
import { createAttachmentRecord } from '@/lib/chat-store'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_FILES = 5
const MAX_TEXT_CHARS = 240_000
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.pdf'])

function publicError(error: unknown) {
  return error instanceof Error ? error.message : 'attachment upload failed'
}

function extension(filename: string) {
  const index = filename.lastIndexOf('.')
  return index >= 0 ? filename.slice(index).toLowerCase() : ''
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'attachment'
}

async function extractText(buffer: Buffer, ext: string) {
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer })
    try {
      const parsed = await parser.getText()
      return parsed.text.slice(0, MAX_TEXT_CHARS)
    } finally {
      await parser.destroy()
    }
  }
  const text = new TextDecoder().decode(buffer)
  return text.slice(0, MAX_TEXT_CHARS)
}

export async function POST(req: Request) {
  const startedAt = Date.now()
  try {
    const form = await req.formData()
    const threadId = String(form.get('threadId') ?? '').trim()
    const messageId = String(form.get('messageId') ?? '').trim() || undefined
    if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 })

    const files = form.getAll('files').filter((item): item is File => item instanceof File)
    if (!files.length) return NextResponse.json({ error: 'at least one file is required' }, { status: 400 })
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `maximum ${MAX_FILES} files per message` }, { status: 400 })
    }

    const attachments = []
    for (const file of files) {
      const ext = extension(file.name)
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return NextResponse.json({ error: `unsupported file type: ${file.name}` }, { status: 400 })
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `file exceeds 10 MB: ${file.name}` }, { status: 400 })
      }

      const filename = safeFilename(file.name)
      const pathname = `musicrag/attachments/${threadId}/${crypto.randomUUID()}-${filename}`
      const buffer = Buffer.from(await file.arrayBuffer())
      const [blob, text] = await Promise.all([
        put(pathname, buffer, {
          access: 'public',
          contentType: file.type || 'application/octet-stream'
        }),
        extractText(buffer, ext)
      ])
      const attachment = await createAttachmentRecord({
        threadId,
        messageId,
        filename,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        blobUrl: blob.url,
        text,
        status: 'extracted'
      })
      attachments.push(attachment)
    }

    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'attachments_uploaded',
        route: '/api/attachments',
        threadId,
        count: attachments.length,
        ms: Date.now() - startedAt
      })
    )
    return NextResponse.json({ attachments }, { status: 201 })
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'attachments_failed',
        route: '/api/attachments',
        error: publicError(error),
        ms: Date.now() - startedAt
      })
    )
    return NextResponse.json({ error: publicError(error) }, { status: 500 })
  }
}
