export type Source = {
  title?: string
  channel?: string
  guests?: string[]
  video_id?: string
  start_sec?: number | null
  end_sec?: number | null
  deep_link?: string | null
  snippet?: string
  score?: number
}

export type Filters = {
  channel?: string
  guest?: string
  topic?: string
  date_from_ts?: number
  date_to_ts?: number
}

export type Facets = {
  channels: { channel: string; episode_count?: number; transcribed_count?: number }[]
  guests: { name: string; slug: string; episode_count: number }[]
  topics: { name: string; slug: string; episode_count: number }[]
}

