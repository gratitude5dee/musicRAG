import assert from 'node:assert/strict'
import test from 'node:test'
import { getModelModes, validateModelSelection, ModelSelectionError } from '../lib/models.ts'

test('model modes include fast and allowlisted expert models', () => {
  const modes = getModelModes({
    GENERATION_MODEL: 'google/gemini-3.5-flash',
    EXPERT_GENERATION_MODEL: 'google/gemini-3.5-pro',
    AI_GATEWAY_MODEL_ALLOWLIST: 'google/gemini-3.5-pro,google/gemini-3.5-flash'
  })

  assert.equal(modes[0].mode, 'fast')
  assert.equal(modes[0].defaultModel, 'google/gemini-3.5-flash')
  assert.equal(modes[1].mode, 'expert')
  assert.equal(modes[1].defaultModel, 'google/gemini-3.5-pro')
  assert.deepEqual(
    modes[1].models.map((model) => model.id),
    ['google/gemini-3.5-pro', 'google/gemini-3.5-flash']
  )
})

test('model selection rejects unknown client supplied models', () => {
  assert.throws(
    () =>
      validateModelSelection({
        mode: 'expert',
        model: 'openai/gpt-5.4',
        env: {
          GENERATION_MODEL: 'google/gemini-3.5-flash',
          AI_GATEWAY_MODEL_ALLOWLIST: 'google/gemini-3.5-pro'
        }
      }),
    ModelSelectionError
  )
})

test('model selection falls back to fast mode by default', () => {
  const selection = validateModelSelection({
    env: {
      GENERATION_MODEL: 'google/gemini-3.5-flash'
    }
  })
  assert.deepEqual(selection, { mode: 'fast', model: 'google/gemini-3.5-flash' })
})
