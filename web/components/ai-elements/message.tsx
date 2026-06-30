'use client'

import type { ReactNode } from 'react'
import type { Source } from '@/lib/types'
import { InlineCitation } from './inline-citation'

const INLINE_RE = /(\*\*[^*]+\*\*|\[S\d+\])/g

function inlineParts(text: string, sources: Source[], onCitationClick?: (id: string) => void): ReactNode[] {
  return text
    .split(INLINE_RE)
    .filter(Boolean)
    .map((part, index) => {
      const citation = part.match(/^\[(S\d+)\]$/)
      if (citation) {
        const id = citation[1]
        return (
          <InlineCitation
            id={id}
            key={`${id}-${index}`}
            source={sources.find((source) => source.id === id)}
            onSelect={onCitationClick}
          />
        )
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`strong-${index}`}>{part.slice(2, -2)}</strong>
      }
      return <span key={`text-${index}`}>{part}</span>
    })
}

export function MessageResponse({
  children,
  sources,
  onCitationClick
}: {
  children: string
  sources: Source[]
  onCitationClick?: (id: string) => void
}) {
  const lines = children.split('\n')
  return (
    <div className="answer-markdown">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <div className="answer-gap" key={`gap-${index}`} />
        const heading = trimmed.match(/^#{1,3}\s+(.+)$/)
        if (heading) {
          return <h3 key={`heading-${index}`}>{inlineParts(heading[1], sources, onCitationClick)}</h3>
        }
        const numbered = trimmed.match(/^\d+\.\s+(.+)$/)
        if (numbered) {
          return <h3 key={`numbered-${index}`}>{inlineParts(trimmed, sources, onCitationClick)}</h3>
        }
        const bullet = trimmed.match(/^[-*]\s+(.+)$/)
        if (bullet) {
          return <p className="answer-bullet" key={`bullet-${index}`}>{inlineParts(bullet[1], sources, onCitationClick)}</p>
        }
        return <p key={`line-${index}`}>{inlineParts(trimmed, sources, onCitationClick)}</p>
      })}
    </div>
  )
}
