'use client'

import type { Source } from '@/lib/types'

export function InlineCitation({
  id,
  source,
  onSelect
}: {
  id: string
  source?: Source
  onSelect?: (id: string) => void
}) {
  return (
    <button
      className="citation-marker"
      type="button"
      title={source ? `${source.title} · ${source.channel}` : id}
      onClick={() => onSelect?.(id)}
    >
      {id}
    </button>
  )
}
