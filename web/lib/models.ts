import type { ChatMode, ModelModeOption } from './types'

export class ModelSelectionError extends Error {
  status = 400
}

const FAST_MODEL = 'google/gemini-3.5-flash'

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function labelForModel(model: string) {
  const short = model.split('/').at(-1) ?? model
  return short
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

export function getModelModes(env: NodeJS.ProcessEnv = process.env): ModelModeOption[] {
  const fastModel = env.GENERATION_MODEL?.trim() || FAST_MODEL
  const allowlist = unique([
    ...(env.AI_GATEWAY_MODEL_ALLOWLIST ?? '').split(','),
    env.EXPERT_GENERATION_MODEL ?? '',
    fastModel
  ])
  const expertDefault =
    env.EXPERT_GENERATION_MODEL && allowlist.includes(env.EXPERT_GENERATION_MODEL)
      ? env.EXPERT_GENERATION_MODEL
      : allowlist[0] ?? fastModel

  return [
    {
      mode: 'fast',
      label: 'Fast',
      defaultModel: fastModel,
      models: [{ id: fastModel, label: labelForModel(fastModel) }]
    },
    {
      mode: 'expert',
      label: 'Expert',
      defaultModel: expertDefault,
      models: allowlist.map((model) => ({ id: model, label: labelForModel(model) }))
    }
  ]
}

export function validateModelSelection({
  mode,
  model,
  env = process.env
}: {
  mode?: string
  model?: string
  env?: NodeJS.ProcessEnv
}): { mode: ChatMode; model: string } {
  const modes = getModelModes(env)
  const requestedMode = mode === 'expert' ? 'expert' : 'fast'
  const modeConfig = modes.find((item) => item.mode === requestedMode)
  if (!modeConfig) throw new ModelSelectionError(`Unsupported chat mode: ${mode}`)

  const selectedModel = model?.trim() || modeConfig.defaultModel
  const allowed = new Set(modeConfig.models.map((item) => item.id))
  if (!allowed.has(selectedModel)) {
    throw new ModelSelectionError(`Model is not enabled for ${requestedMode} mode: ${selectedModel}`)
  }
  return { mode: requestedMode, model: selectedModel }
}
