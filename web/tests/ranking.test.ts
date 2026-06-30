import assert from 'node:assert/strict'
import test from 'node:test'
import { diversifyByEpisode, uniqueEpisodeCount } from '../lib/ranking.ts'

function doc(video_id: string, chunk_index: number, score: number) {
  return {
    chunk_uid: `${video_id}:${chunk_index}`,
    video_id,
    chunk_index,
    combined_score: score
  }
}

test('diversifies a clustered source list before allowing second chunks', () => {
  const docs = [
    doc('A', 0, 1),
    doc('A', 1, 0.99),
    doc('A', 2, 0.98),
    doc('B', 0, 0.9),
    doc('C', 0, 0.8),
    doc('D', 0, 0.7),
    doc('E', 0, 0.6),
    doc('B', 1, 0.5)
  ]

  const diversified = diversifyByEpisode(docs, 6, { maxPerEpisode: 2, minEpisodes: 5 })
  const counts = new Map<string, number>()
  for (const item of diversified) counts.set(item.video_id, (counts.get(item.video_id) ?? 0) + 1)

  assert.equal(diversified.length, 6)
  assert.equal(uniqueEpisodeCount(diversified), 5)
  assert.equal(counts.get('A'), 2)
})

test('can enforce one chunk per episode for broad first-pass recall', () => {
  const docs = [
    doc('A', 0, 1),
    doc('A', 1, 0.99),
    doc('A', 2, 0.98),
    doc('B', 0, 0.9),
    doc('C', 0, 0.8),
    doc('D', 0, 0.7),
    doc('E', 0, 0.6)
  ]

  const diversified = diversifyByEpisode(docs, 5, { maxPerEpisode: 1, minEpisodes: 5 })
  assert.deepEqual(diversified.map((item) => item.video_id), ['A', 'B', 'C', 'D', 'E'])
})
