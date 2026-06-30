'use client'

import { Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'

export function AnswerActions({ answer }: { answer: string }) {
  if (!answer) return null
  return (
    <div className="answer-actions">
      <button type="button" title="Regenerate">
        <RotateCcw size={16} aria-hidden="true" />
      </button>
      <button type="button" title="Copy" onClick={() => void navigator.clipboard?.writeText(answer)}>
        <Copy size={16} aria-hidden="true" />
      </button>
      <button type="button" title="Helpful">
        <ThumbsUp size={16} aria-hidden="true" />
      </button>
      <button type="button" title="Not helpful">
        <ThumbsDown size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
