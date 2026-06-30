'use client'

import { Paperclip, Send, Square, SlidersHorizontal } from 'lucide-react'
import { FormEvent } from 'react'
import type { ChatMode, ModelModeOption } from '@/lib/types'

export function PromptInput({
  value,
  disabled,
  mode,
  model,
  modes,
  onChange,
  onModeChange,
  onSubmit,
  onToggleFilters
}: {
  value: string
  disabled?: boolean
  mode: ChatMode
  model: string
  modes: ModelModeOption[]
  onChange: (value: string) => void
  onModeChange: (mode: ChatMode, model: string) => void
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
      <select
        className="mode-select"
        value={`${mode}:${model}`}
        onChange={(event) => {
          const [nextMode, nextModel] = event.target.value.split(':') as [ChatMode, string]
          onModeChange(nextMode, nextModel)
        }}
        title="Model mode"
      >
        {modes.map((modeOption) =>
          modeOption.models.map((modelOption) => (
            <option key={`${modeOption.mode}:${modelOption.id}`} value={`${modeOption.mode}:${modelOption.id}`}>
              {modeOption.label} · {modelOption.label}
            </option>
          ))
        )}
        {!modes.length ? <option value={`${mode}:${model}`}>Fast · Gemini 3.5 Flash</option> : null}
      </select>
      <button className="mode-button" type="button" onClick={onToggleFilters} title="Filters">
        <SlidersHorizontal size={16} aria-hidden="true" />
      </button>
      <button className="send-button" type="submit" disabled={disabled || !value.trim()} title={disabled ? 'Generating' : 'Send'}>
        {disabled ? <Square size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
      </button>
    </form>
  )
}
