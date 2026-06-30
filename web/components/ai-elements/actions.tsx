'use client'

import { Copy, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'

export function AnswerActions({
  answer,
  feedback,
  onFeedback,
  onRegenerate
}: {
  answer: string
  feedback?: 'up' | 'down'
  onFeedback?: (rating: 'up' | 'down') => void
  onRegenerate?: () => void
}) {
  if (!answer) return null
  return (
    <div className="answer-actions">
      <button type="button" title="Regenerate" onClick={onRegenerate}>
        <RotateCcw size={16} aria-hidden="true" />
      </button>
      <button type="button" title="Copy" onClick={() => void navigator.clipboard?.writeText(answer)}>
        <Copy size={16} aria-hidden="true" />
      </button>
      <button
        className={feedback === 'up' ? 'active' : ''}
        type="button"
        title="Helpful"
        onClick={() => onFeedback?.('up')}
      >
        <ThumbsUp size={16} aria-hidden="true" />
      </button>
      <button
        className={feedback === 'down' ? 'active' : ''}
        type="button"
        title="Not helpful"
        onClick={() => onFeedback?.('down')}
      >
        <ThumbsDown size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
