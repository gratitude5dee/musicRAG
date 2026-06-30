export type Source = {
  id?: string
  chunk_uid?: string
  title?: string
  channel?: string
  guests?: string[]
  video_id?: string
  start_sec?: number | null
  end_sec?: number | null
  deep_link?: string | null
  snippet?: string
  score?: number
  chunk_index?: number | null
}

export type Filters = {
  channel?: string
  guest?: string
  topic?: string
  date_from_ts?: number
  date_to_ts?: number
}

export type ChatMode = 'fast' | 'expert'

export type ModelOption = {
  id: string
  label: string
}

export type ModelModeOption = {
  mode: ChatMode
  label: string
  defaultModel: string
  models: ModelOption[]
}

export type ChatMessage = {
  message_id: string
  thread_id: string
  role: 'user' | 'assistant'
  content: string
  status?: 'pending' | 'streaming' | 'complete' | 'error'
  model?: string
  mode?: ChatMode
  run_id?: string
  parent_message_id?: string
  version?: number
  source_ids?: string[]
  attachment_ids?: string[]
  created_at?: string
  updated_at?: string
}

export type ChatThread = {
  thread_id: string
  title: string
  project_id?: string | null
  pinned?: boolean
  archived?: boolean
  last_message_at?: string
  created_at?: string
  updated_at?: string
}

export type Facets = {
  channels: { channel: string; episode_count?: number; transcribed_count?: number }[]
  guests: { name: string; slug: string; episode_count: number }[]
  topics: { name: string; slug: string; episode_count: number }[]
}

export type AgentTraceEvent = {
  step: 'classify' | 'search_transcripts' | 'expand_context' | 'grade_context' | 'synthesize' | 'citation_validation'
  label: string
  detail?: string
  count?: number
  token_count?: number
}
