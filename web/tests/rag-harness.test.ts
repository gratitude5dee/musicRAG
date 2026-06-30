import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateTokenCount, validateCitations } from '../lib/rag-harness.ts'
import type { Source } from '../lib/types.ts'

const sources: Source[] = [
  { id: 'S1', title: 'A&R Roundtable', channel: 'MUBUTV', snippet: 'A&R teams watch consistency and audience signal.' },
  { id: 'S2', title: 'Manager Talk', channel: 'Musformation', snippet: 'Managers look for repeatable creative systems.' }
]

test('valid citations pass', () => {
  const result = validateCitations('A&R teams look for consistency [S1]. Managers value repeatable systems [S2].', sources)
  assert.equal(result.ok, true)
  assert.deepEqual(result.citedSourceIds, ['S1', 'S2'])
})

test('hallucinated source ids trigger correction', () => {
  const result = validateCitations('A&R teams only care about radio [S9].', sources)
  assert.equal(result.ok, false)
  assert.match(result.correction ?? '', /S9/)
})

test('factual answers without citations trigger correction', () => {
  const result = validateCitations('A&R teams look for consistency.', sources)
  assert.equal(result.ok, false)
  assert.match(result.correction ?? '', /no source markers/i)
})

test('not-found answers may omit citations', () => {
  const result = validateCitations('The excerpts do not contain enough evidence to answer.', sources)
  assert.equal(result.ok, true)
})

test('raw links are rejected', () => {
  const result = validateCitations('Read this [clip](https://youtube.com/watch?v=abc) [S1].', sources)
  assert.equal(result.ok, false)
  assert.match(result.correction ?? '', /raw URLs/)
})

test('token estimate uses the harness budget heuristic', () => {
  assert.equal(estimateTokenCount('12345678'), 2)
  assert.equal(estimateTokenCount('123456789'), 3)
})
