'use client'

import {
  Bookmark,
  History,
  Library,
  Maximize2,
  PenLine,
  Search,
  Share,
  SlidersHorizontal
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnswerActions } from '@/components/ai-elements/actions'
import { ThinkingPanel } from '@/components/ai-elements/loader'
import { MessageResponse } from '@/components/ai-elements/message'
import { PromptInput } from '@/components/ai-elements/prompt-input'
import { SourcesPanel } from '@/components/ai-elements/sources'
import type { AgentTraceEvent, Facets, Filters, Source } from '@/lib/types'

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
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [trace, setTrace] = useState<AgentTraceEvent[]>([])
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesRef = useRef<HTMLDivElement>(null)

  const latestAnswer = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? '',
    [messages]
  )

  useEffect(() => {
    fetch('/api/facets')
      .then((res) => res.json())
      .then(setFacets)
      .catch(() => setFacets({ channels: [], guests: [], topics: [] }))
  }, [])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, trace, sources])

  async function ask(question: string) {
    if (!question.trim() || loading) return
    setLoading(true)
    setError(null)
    setRunId(null)
    setTrace([])
    setSources([])
    setActiveSourceId(null)
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
          if (event === 'meta') {
            const payload = JSON.parse(data) as { runId?: string; trace?: AgentTraceEvent[] }
            if (payload.runId) setRunId(payload.runId)
            if (payload.trace) setTrace(payload.trace)
          }
          if (event === 'thinking') {
            const payload = JSON.parse(data) as { label?: string }
            setTrace((prev) => [
              ...prev,
              { step: 'classify', label: payload.label ?? 'Thinking about your request' }
            ])
          }
          if (event === 'tool') {
            const payload = JSON.parse(data) as AgentTraceEvent
            setTrace((prev) => [...prev, payload])
          }
          if (event === 'sources') {
            const nextSources = JSON.parse(data) as Source[]
            setSources(nextSources)
            setActiveSourceId(nextSources[0]?.id ?? null)
          }
          if (event === 'citation_retry') {
            const payload = JSON.parse(data) as { attempt?: number; correction?: string }
            setTrace((prev) => [
              ...prev,
              {
                step: 'citation_validation',
                label: `citation retry ${payload.attempt ?? ''}`.trim(),
                detail: payload.correction
              }
            ])
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
          if (event === 'done') {
            const payload = JSON.parse(data) as { runId?: string }
            if (payload.runId) setRunId(payload.runId)
          }
          if (event === 'error') {
            const payload = JSON.parse(data) as { message?: string; runId?: string }
            if (payload.runId) setRunId(payload.runId)
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

  return (
    <main className="research-shell">
      <header className="app-top">
        <button className="top-icon" type="button" title="Focus">
          <Maximize2 size={18} aria-hidden="true" />
        </button>
        <div className="brand-pill">
          <Library size={18} aria-hidden="true" />
          <span>MusicRAG</span>
        </div>
        <nav className="top-actions" aria-label="Session actions">
          <button type="button" title="Share"><Share size={18} aria-hidden="true" /></button>
          <button type="button" title="Bookmark"><Bookmark size={18} aria-hidden="true" /></button>
          <button type="button" title="History"><History size={18} aria-hidden="true" /></button>
          <button type="button" title="New question"><PenLine size={18} aria-hidden="true" /></button>
        </nav>
      </header>

      <section className="chat-stage">
        <div className="conversation" ref={messagesRef}>
          {messages.length === 0 ? (
            <div className="empty-chat">
              <p>Ask the music industry transcripts</p>
              <h1>Find the exact moment an idea was said.</h1>
              <div className="prompt-row">
                {prompts.map((prompt) => (
                  <button className="prompt-chip" key={prompt} onClick={() => void ask(prompt)}>
                    <Search size={14} aria-hidden="true" /> {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                {message.role === 'user' ? (
                  <div className="user-bubble">{message.content}</div>
                ) : (
                  <div className="assistant-answer">
                    {message.content ? (
                      <>
                        <MessageResponse sources={sources} onCitationClick={setActiveSourceId}>
                          {message.content}
                        </MessageResponse>
                        <AnswerActions answer={message.content} />
                      </>
                    ) : (
                      <ThinkingPanel loading={loading} trace={trace} sources={sources} />
                    )}
                  </div>
                )}
              </article>
            ))
          )}
          {error ? <p className="error-line">{error}</p> : null}
        </div>

        {filtersOpen ? (
          <div className="filter-dock">
            <label>
              Channel
              <select
                value={filters.channel ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, channel: event.target.value || undefined }))}
              >
                <option value="">All channels</option>
                {facets.channels.map((channel) => (
                  <option key={channel.channel} value={channel.channel}>{channel.channel}</option>
                ))}
              </select>
            </label>
            <label>
              Guest
              <select
                value={filters.guest ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, guest: event.target.value || undefined }))}
              >
                <option value="">Any guest</option>
                {facets.guests.map((guest) => (
                  <option key={guest.slug} value={guest.name}>{guest.name}</option>
                ))}
              </select>
            </label>
            <label>
              Topic
              <select
                value={filters.topic ?? ''}
                onChange={(event) => setFilters((prev) => ({ ...prev, topic: event.target.value || undefined }))}
              >
                <option value="">Any topic</option>
                {facets.topics.map((topic) => (
                  <option key={topic.slug} value={topic.name}>{topic.name}</option>
                ))}
              </select>
            </label>
            <span><SlidersHorizontal size={14} aria-hidden="true" /> Filters apply before vector search.</span>
          </div>
        ) : null}

        <div className="composer-wrap">
          <PromptInput
            value={input}
            disabled={loading}
            onChange={setInput}
            onSubmit={() => void ask(input)}
            onToggleFilters={() => setFiltersOpen((open) => !open)}
          />
          {runId ? <div className="run-id">{runId}</div> : null}
        </div>
      </section>

      <SourcesPanel sources={sources} activeSourceId={activeSourceId} onSelect={setActiveSourceId} />
    </main>
  )
}
