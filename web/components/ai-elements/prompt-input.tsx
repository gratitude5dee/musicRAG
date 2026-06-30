'use client'

import { Paperclip, Send, Square, SlidersHorizontal } from 'lucide-react'
import { FormEvent } from 'react'

export function PromptInput({
  value,
  disabled,
  onChange,
  onSubmit,
  onToggleFilters
}: {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onSubmit: () => void
  onToggleFilters: () => void
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form className="prompt-input" onSubmit={submit}>
      <button className="ghost-icon" type="button" title="Attach context" disabled>
        <Paperclip size={18} aria-hidden="true" />
      </button>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ask about A&R, publishing, managers, rollouts, mixing, touring..."
        disabled={disabled}
      />
      <button className="mode-button" type="button" onClick={onToggleFilters}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        Expert
      </button>
      <button className="send-button" type="submit" disabled={disabled || !value.trim()} title={disabled ? 'Generating' : 'Send'}>
        {disabled ? <Square size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
      </button>
    </form>
  )
}
