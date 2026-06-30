'use client'

import { ExternalLink, PlayCircle } from 'lucide-react'
import { secondsToMmss } from '@/lib/gateway'
import type { Source } from '@/lib/types'

export function SourcesPanel({
  sources,
  activeSourceId,
  onSelect
}: {
  sources: Source[]
  activeSourceId?: string | null
  onSelect?: (id: string) => void
}) {
  return (
    <aside className="sources-rail" aria-label="Sources">
      <div className="sources-head">
        <p>Sources</p>
        <span>{sources.length ? `${sources.length} transcript chunks` : 'Awaiting a question'}</span>
      </div>
      <div className="source-stack">
        {sources.map((source) => (
          <a
            className={`source-card ${source.id === activeSourceId ? 'active' : ''}`}
            href={source.deep_link ?? '#'}
            key={`${source.id}-${source.video_id}-${source.start_sec}`}
            rel="noreferrer"
            target="_blank"
            onMouseEnter={() => source.id && onSelect?.(source.id)}
            onFocus={() => source.id && onSelect?.(source.id)}
          >
            <div className="source-card-top">
              <span className="source-id">{source.id}</span>
              <PlayCircle size={16} aria-hidden="true" />
            </div>
            <strong>{source.title}</strong>
            <div className="source-meta">
              {source.channel} · {secondsToMmss(source.start_sec)}
            </div>
            <p>{source.snippet}</p>
            <span className="source-link">
              Open timestamp <ExternalLink size={13} aria-hidden="true" />
            </span>
          </a>
        ))}
      </div>
    </aside>
  )
}

export function SourceChipRow({ sources }: { sources: Source[] }) {
  const chips = sources.slice(0, 5)
  if (!chips.length) return null
  return (
    <div className="source-chip-row">
      {chips.map((source) => (
        <span className="source-chip" key={`${source.id}-chip`}>
          {source.id} · {source.channel || 'transcript'}
        </span>
      ))}
      {sources.length > chips.length ? <span className="source-chip">+{sources.length - chips.length} more</span> : null}
    </div>
  )
}
