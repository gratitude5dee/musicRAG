type EpisodeLike = Record<string, unknown>

function chunkKey(doc: EpisodeLike) {
  return String(doc.chunk_uid ?? `${doc.video_id ?? 'unknown'}:${doc.chunk_index ?? 'unknown'}`)
}

function episodeKey(doc: EpisodeLike) {
  return String(doc.video_id ?? chunkKey(doc))
}

export function uniqueEpisodeCount(docs: EpisodeLike[]) {
  return new Set(docs.map(episodeKey)).size
}

export function diversifyByEpisode<T extends EpisodeLike>(
  docs: T[],
  limit: number,
  options: { maxPerEpisode?: number; minEpisodes?: number } = {}
) {
  const maxPerEpisode = Math.max(1, options.maxPerEpisode ?? 2)
  const minEpisodes = Math.min(limit, Math.max(1, options.minEpisodes ?? Math.ceil(limit / 2)))
  const selected: T[] = []
  const selectedChunks = new Set<string>()
  const episodeCounts = new Map<string, number>()

  function add(doc: T, perEpisodeCap: number) {
    if (selected.length >= limit) return false
    const cKey = chunkKey(doc)
    if (selectedChunks.has(cKey)) return false
    const eKey = episodeKey(doc)
    const current = episodeCounts.get(eKey) ?? 0
    if (current >= perEpisodeCap) return false
    selected.push(doc)
    selectedChunks.add(cKey)
    episodeCounts.set(eKey, current + 1)
    return true
  }

  for (const doc of docs) {
    if (episodeCounts.size >= minEpisodes || selected.length >= limit) break
    add(doc, 1)
  }

  for (const doc of docs) {
    if (selected.length >= limit) break
    add(doc, maxPerEpisode)
  }

  for (const doc of docs) {
    if (selected.length >= limit) break
    add(doc, Number.POSITIVE_INFINITY)
  }

  return selected
}
