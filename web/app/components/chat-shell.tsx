'use client'

import { Filter, Library, PlayCircle, Search, Send, SlidersHorizontal } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { Facets, Filters, Source } from '@/lib/types'
import { secondsToMmss } from '@/lib/gateway'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

const prompts = [
  'How do A&R people spot promising artists?',
  'What are managers saying about rollout strategy?',
  'Compare independent artist advice across channels.'
]

function parseSseEvent(block: string) {
  const lines = block.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  return { event, data }
}

export function ChatShell() {
  const [facets, setFacets] = useState<Facets>({ channels: [], guests: [], topics: [] })
  const [filters, setFilters] = useState<Filters>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/facets')
      .then((res) => res.json())
      .then(setFacets)
      .catch(() => setFacets({ channels: [], guests: [], topics: [] }))
  }, [])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function ask(question: string) {
    if (!question.trim() || loading) return
    setLoading(true)
    setError(null)
    setSources([])
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '' }])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, filters })
      })
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error ?? 'Chat request failed')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          if (!block.trim()) continue
          const { event, data } = parseSseEvent(block)
          if (event === 'sources') {
            setSources(JSON.parse(data) as Source[])
          }
          if (event === 'token') {
            const token = (JSON.parse(data) as { token: string }).token
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') last.content += token
              return next
            })
          }
          if (event === 'error') {
            const payload = JSON.parse(data) as { message?: string }
            throw new Error(payload.message ?? 'Stream failed')
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && !last.content) last.content = `Error: ${message}`
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void ask(input)
  }

  return (
    <main className="app-shell">
      <aside className="side-panel">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Library size={18} />
          </div>
          <div>
            <h1>MusicRAG</h1>
            <p>MongoDB + Voyage + Gemini Gateway</p>
          </div>
        </div>

        <div className="filter-group">
          <label htmlFor="channel">Channel</label>
          <select
            id="channel"
            value={filters.channel ?? ''}
            onChange={(event) => setFilters((prev) => ({ ...prev, channel: event.target.value || undefined }))}
          >
            <option value="">All channels</option>
            {facets.channels.map((channel) => (
              <option key={channel.channel} value={channel.channel}>
                {channel.channel}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="guest">Guest</label>
          <select
            id="guest"
            value={filters.guest ?? ''}
            onChange={(event) => setFilters((prev) => ({ ...prev, guest: event.target.value || undefined }))}
          >
            <option value="">Any guest</option>
            {facets.guests.map((guest) => (
              <option key={guest.slug} value={guest.name}>
                {guest.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="topic">Topic</label>
          <select
            id="topic"
            value={filters.topic ?? ''}
            onChange={(event) => setFilters((prev) => ({ ...prev, topic: event.target.value || undefined }))}
          >
            <option value="">Any topic</option>
            {facets.topics.map((topic) => (
              <option key={topic.slug} value={topic.name}>
                {topic.name}
              </option>
            ))}
          </select>
        </div>

        <p className="muted">
          <SlidersHorizontal size={14} /> Filters are passed into MongoDB vector search before retrieval.
        </p>
      </aside>

      <section className="main-panel">
        <header className="top-bar">
          <div>
            <h2>Ask the Music Industry Transcripts</h2>
            <p>Answers stream from Gemini 3.5 Flash through Vercel AI Gateway and stay grounded in timestamped transcript chunks.</p>
          </div>
          <div className="status-pill">{loading ? 'retrieving' : 'ready'}</div>
        </header>

        <div className="messages" ref={messagesRef}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <h3>Find the exact moment a music idea was said.</h3>
              <div className="prompt-row">
                {prompts.map((prompt) => (
                  <button className="prompt-chip" key={prompt} onClick={() => void ask(prompt)}>
                    <Search size={14} /> {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                <div className="message-role">{message.role}</div>
                <div className="message-body">{message.content || (message.role === 'assistant' ? '...' : '')}</div>
              </div>
            ))
          )}
          {error ? <p className="error">{error}</p> : null}
        </div>

        <form className="composer" onSubmit={submit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about A&R, publishing, managers, rollouts, mixing, touring..."
            disabled={loading}
          />
          <button className="icon-button" type="submit" disabled={loading} title="Send question">
            <Send size={18} />
          </button>
        </form>
      </section>

      <aside className="sources-panel">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Filter size={18} />
          </div>
          <div>
            <h1>Sources</h1>
            <p>{sources.length ? `${sources.length} cited chunks` : 'Awaiting a question'}</p>
          </div>
        </div>
        <div className="source-list">
          {sources.map((source, index) => (
            <a className="source-item" href={source.deep_link ?? '#'} target="_blank" rel="noreferrer" key={`${source.video_id}-${source.start_sec}-${index}`}>
              <div className="source-title">
                <PlayCircle size={16} color="var(--accent)" />
                <strong>{source.title}</strong>
              </div>
              <div className="source-meta">
                {source.channel} @ {secondsToMmss(source.start_sec)}
              </div>
              <div className="source-snippet">{source.snippet}</div>
            </a>
          ))}
        </div>
      </aside>
    </main>
  )
}

