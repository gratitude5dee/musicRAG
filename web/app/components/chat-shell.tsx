'use client'

import {
  Bookmark,
  ChevronLeft,
  History,
  Library,
  Maximize2,
  PenLine,
  Plus,
  Search,
  Share,
  SlidersHorizontal,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { AnswerActions } from '@/components/ai-elements/actions'
import { ThinkingPanel } from '@/components/ai-elements/loader'
import { MessageResponse } from '@/components/ai-elements/message'
import { PromptInput } from '@/components/ai-elements/prompt-input'
import { SourcesPanel } from '@/components/ai-elements/sources'
import type {
  AgentTraceEvent,
  ChatMessage,
  ChatMode,
  ChatThread,
  Facets,
  Filters,
  ModelModeOption,
  Source
} from '@/lib/types'

const prompts = [
  'How do A&R people spot promising artists?',
  'What are managers saying about rollout strategy?',
  'Compare independent artist advice across channels.'
]

const SESSION_KEY = 'musicrag_session_id'

function parseSseEvent(block: string) {
  const lines = block.split('\n')
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  return { event, data }
}

function localMessage(role: 'user' | 'assistant', content: string): ChatMessage {
  return {
    message_id: `local_${crypto.randomUUID()}`,
    thread_id: 'local',
    role,
    content,
    status: role === 'assistant' ? 'streaming' : 'complete'
  }
}

function getOrCreateSessionId() {
  const existing = window.localStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const next = `session_${crypto.randomUUID()}`
  window.localStorage.setItem(SESSION_KEY, next)
  return next
}

export function ChatShell({ initialThreadId }: { initialThreadId?: string }) {
  const [facets, setFacets] = useState<Facets>({ channels: [], guests: [], topics: [] })
  const [filters, setFilters] = useState<Filters>({})
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [threadId, setThreadId] = useState<string | null>(initialThreadId ?? null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[]>([])
  const [sourcesOpen, setSourcesOpen] = useState(true)
  const [trace, setTrace] = useState<AgentTraceEvent[]>([])
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelModes, setModelModes] = useState<ModelModeOption[]>([])
  const [mode, setMode] = useState<ChatMode>('fast')
  const [model, setModel] = useState('google/gemini-3.5-flash')
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({})
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const nextSessionId = getOrCreateSessionId()
    setSessionId(nextSessionId)
  }, [])

  useEffect(() => {
    fetch('/api/facets')
      .then((res) => res.json())
      .then(setFacets)
      .catch(() => setFacets({ channels: [], guests: [], topics: [] }))

    fetch('/api/models')
      .then((res) => res.json())
      .then((payload: { modes?: ModelModeOption[] }) => {
        const modes = payload.modes ?? []
        setModelModes(modes)
        const fast = modes.find((item) => item.mode === 'fast')
        if (fast) setModel(fast.defaultModel)
      })
      .catch(() => setModelModes([]))
  }, [])

  useEffect(() => {
    if (!sessionId) return
    void refreshThreads(sessionId)
  }, [sessionId])

  useEffect(() => {
    if (!initialThreadId) return
    void loadThread(initialThreadId)
  }, [initialThreadId])

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, trace, sources])

  async function refreshThreads(activeSessionId = sessionId) {
    if (!activeSessionId) return
    const response = await fetch(`/api/threads?sessionId=${encodeURIComponent(activeSessionId)}`)
    if (!response.ok) return
    const payload = (await response.json()) as { threads?: ChatThread[] }
    setThreads(payload.threads ?? [])
  }

  async function loadThread(id: string) {
    setError(null)
    const response = await fetch(`/api/threads/${encodeURIComponent(id)}`)
    if (!response.ok) {
      setError('Thread not found or unavailable.')
      return
    }
    const payload = (await response.json()) as { thread: ChatThread; messages: ChatMessage[] }
    setThreadId(payload.thread.thread_id)
    setMessages(payload.messages)
    setSources([])
    setTrace([])
    setRunId(payload.messages.findLast((message) => message.run_id)?.run_id ?? null)
    window.history.replaceState(null, '', `/chat/${payload.thread.thread_id}`)
  }

  function startNewChat() {
    setThreadId(null)
    setMessages([])
    setSources([])
    setTrace([])
    setRunId(null)
    setError(null)
    setActiveSourceId(null)
    window.history.pushState(null, '', '/')
  }

  async function ask(
    question: string,
    overrides: {
      threadId?: string | null
      parentRunId?: string
      parentMessageId?: string
      mode?: ChatMode
      model?: string
    } = {}
  ) {
    if (!question.trim() || loading) return
    const selectedMode = overrides.mode ?? mode
    const selectedModel = overrides.model ?? model
    setLoading(true)
    setError(null)
    setRunId(null)
    setTrace([])
    setSources([])
    setActiveSourceId(null)
    setInput('')
    setMessages((prev) => [
      ...prev,
      localMessage('user', question),
      localMessage('assistant', '')
    ])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          filters,
          threadId: overrides.threadId ?? threadId,
          sessionId,
          mode: selectedMode,
          model: selectedModel,
          parentRunId: overrides.parentRunId,
          parentMessageId: overrides.parentMessageId
        })
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
            const payload = JSON.parse(data) as {
              runId?: string
              threadId?: string
              userMessageId?: string
              assistantMessageId?: string
              trace?: AgentTraceEvent[]
              model?: string
              mode?: ChatMode
            }
            if (payload.runId) setRunId(payload.runId)
            if (payload.threadId) {
              setThreadId(payload.threadId)
              window.history.replaceState(null, '', `/chat/${payload.threadId}`)
            }
            if (payload.model) setModel(payload.model)
            if (payload.mode) setMode(payload.mode)
            if (payload.trace) setTrace(payload.trace)
            if (payload.userMessageId || payload.assistantMessageId) {
              setMessages((prev) => {
                const next = [...prev]
                const assistantIndex = next.length - 1
                const userIndex = next.length - 2
                if (payload.userMessageId && next[userIndex]?.role === 'user') {
                  next[userIndex] = {
                    ...next[userIndex],
                    message_id: payload.userMessageId,
                    thread_id: payload.threadId ?? next[userIndex].thread_id
                  }
                }
                if (payload.assistantMessageId && next[assistantIndex]?.role === 'assistant') {
                  next[assistantIndex] = {
                    ...next[assistantIndex],
                    message_id: payload.assistantMessageId,
                    thread_id: payload.threadId ?? next[assistantIndex].thread_id,
                    run_id: payload.runId ?? next[assistantIndex].run_id,
                    model: payload.model ?? selectedModel,
                    mode: payload.mode ?? selectedMode
                  }
                }
                return next
              })
            }
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
            setSourcesOpen(true)
            setActiveSourceId(nextSources[0]?.id ?? null)
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') {
                last.source_ids = nextSources.map((source) => source.id).filter(Boolean) as string[]
              }
              return next
            })
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
              if (last?.role === 'assistant') {
                last.content += token
                last.status = 'streaming'
              }
              return next
            })
          }
          if (event === 'done') {
            const payload = JSON.parse(data) as { runId?: string }
            if (payload.runId) setRunId(payload.runId)
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') last.status = 'complete'
              return next
            })
          }
          if (event === 'error') {
            const payload = JSON.parse(data) as { message?: string; runId?: string }
            if (payload.runId) setRunId(payload.runId)
            throw new Error(payload.message ?? 'Stream failed')
          }
        }
      }
      await refreshThreads()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          last.status = 'error'
          if (!last.content) last.content = `Error: ${message}`
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  async function submitFeedback(message: ChatMessage, rating: 'up' | 'down') {
    if (!message.message_id || message.message_id.startsWith('local_')) return
    setFeedback((prev) => ({ ...prev, [message.message_id]: rating }))
    await fetch(`/api/messages/${encodeURIComponent(message.message_id)}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating,
        runId: message.run_id,
        threadId: message.thread_id,
        model: message.model,
        sourceIds: message.source_ids ?? sources.map((source) => source.id).filter(Boolean)
      })
    }).catch(() => undefined)
  }

  async function regenerate(message: ChatMessage) {
    if (!message.message_id || message.message_id.startsWith('local_')) return
    const response = await fetch(`/api/messages/${encodeURIComponent(message.message_id)}/regenerate`, {
      method: 'POST'
    })
    if (!response.ok) return
    const payload = (await response.json()) as {
      question: string
      threadId: string
      parentRunId?: string
      parentMessageId?: string
      mode?: ChatMode
      model?: string
    }
    await ask(payload.question, {
      threadId: payload.threadId,
      parentRunId: payload.parentRunId,
      parentMessageId: payload.parentMessageId,
      mode: payload.mode,
      model: payload.model
    })
  }

  return (
    <main className={`research-shell ${sourcesOpen ? '' : 'sources-closed'}`}>
      <aside className="workspace-sidebar" aria-label="Workspace">
        <div className="sidebar-brand">
          <Library size={18} aria-hidden="true" />
          <span>A&amp;Rify</span>
          <button type="button" title="Collapse sidebar">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Primary">
          <button type="button"><Search size={16} aria-hidden="true" /> Search</button>
          <button type="button" onClick={startNewChat}><PenLine size={16} aria-hidden="true" /> New Chat</button>
          <button type="button"><SlidersHorizontal size={16} aria-hidden="true" /> Corpus Filters</button>
        </nav>
        <section className="sidebar-section">
          <p>Projects</p>
          <button type="button" className="sidebar-muted"><Plus size={15} aria-hidden="true" /> New Project</button>
        </section>
        <section className="sidebar-section history-list">
          <p>History</p>
          {threads.length ? (
            threads.map((thread) => (
              <button
                className={thread.thread_id === threadId ? 'active' : ''}
                key={thread.thread_id}
                type="button"
                onClick={() => void loadThread(thread.thread_id)}
                title={thread.title}
              >
                {thread.pinned ? <Bookmark size={13} aria-hidden="true" /> : null}
                <span>{thread.title}</span>
              </button>
            ))
          ) : (
            <span className="sidebar-empty">No saved chats yet</span>
          )}
        </section>
        <div className="sidebar-account">
          <div className="avatar">M</div>
          <div>
            <strong>A&amp;Rify</strong>
            <span>Music intelligence workspace</span>
          </div>
        </div>
      </aside>

      <header className="app-top">
        <button className="top-icon" type="button" title="Focus">
          <Maximize2 size={18} aria-hidden="true" />
        </button>
        <div className="brand-pill">
          <Library size={18} aria-hidden="true" />
          <span>A&amp;Rify</span>
        </div>
        <nav className="top-actions" aria-label="Session actions">
          <button type="button" title="Share"><Share size={18} aria-hidden="true" /></button>
          <button type="button" title="Bookmark"><Bookmark size={18} aria-hidden="true" /></button>
          <button type="button" title="History"><History size={18} aria-hidden="true" /></button>
          <button type="button" title="New chat" onClick={startNewChat}><PenLine size={18} aria-hidden="true" /></button>
          <button type="button" title={sourcesOpen ? 'Hide sources' : 'Show sources'} onClick={() => setSourcesOpen((open) => !open)}>
            {sourcesOpen ? <X size={18} aria-hidden="true" /> : <Library size={18} aria-hidden="true" />}
          </button>
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
            messages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.message_id}>
                {message.role === 'user' ? (
                  <div className="user-bubble">{message.content}</div>
                ) : (
                  <div className="assistant-answer">
                    {message.content ? (
                      <>
                        <MessageResponse sources={sources} onCitationClick={setActiveSourceId}>
                          {message.content}
                        </MessageResponse>
                        <AnswerActions
                          answer={message.content}
                          feedback={feedback[message.message_id]}
                          onFeedback={(rating) => void submitFeedback(message, rating)}
                          onRegenerate={() => void regenerate(message)}
                        />
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
            mode={mode}
            model={model}
            modes={modelModes}
            onChange={setInput}
            onModeChange={(nextMode, nextModel) => {
              setMode(nextMode)
              setModel(nextModel)
            }}
            onSubmit={() => void ask(input)}
            onToggleFilters={() => setFiltersOpen((open) => !open)}
          />
          {runId ? <div className="run-id">{runId}</div> : null}
        </div>
      </section>

      {sourcesOpen ? (
        <SourcesPanel
          sources={sources}
          activeSourceId={activeSourceId}
          onSelect={setActiveSourceId}
          onClose={() => setSourcesOpen(false)}
          trace={trace}
        />
      ) : null}
    </main>
  )
}
