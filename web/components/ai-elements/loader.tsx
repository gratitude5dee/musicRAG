'use client'

import { CircleDot, Search } from 'lucide-react'
import type { AgentTraceEvent, Source } from '@/lib/types'
import { SourceChipRow } from './sources'

export function ThinkingPanel({
  loading,
  trace,
  sources
}: {
  loading: boolean
  trace: AgentTraceEvent[]
  sources: Source[]
}) {
  if (!loading && !trace.length) return null
  return (
    <div className="thinking-panel">
      <div className="thinking-title">
        <CircleDot size={16} aria-hidden="true" />
        <strong>{loading ? 'Thinking about your request' : 'Retrieval trace'}</strong>
      </div>
      <div className="thinking-line">
        <Search size={16} aria-hidden="true" />
        <span>{trace.at(-1)?.label ?? 'Searching transcript corpus'}</span>
      </div>
      <SourceChipRow sources={sources} />
    </div>
  )
}
