import { getDb } from './mongodb'

type ChatRunPatch = Record<string, unknown>

export function newRunId() {
  return `run_${crypto.randomUUID()}`
}

export async function createChatRun(run: ChatRunPatch) {
  try {
    const db = await getDb()
    await db.collection('chat_runs').insertOne({
      ...run,
      created_at: new Date(),
      updated_at: new Date()
    })
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'chat_run_create_failed',
        error: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

export async function updateChatRun(runId: string, patch: ChatRunPatch) {
  try {
    const db = await getDb()
    await db.collection('chat_runs').updateOne(
      { run_id: runId },
      {
        $set: {
          ...patch,
          updated_at: new Date()
        }
      },
      { upsert: true }
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'chat_run_update_failed',
        runId,
        error: error instanceof Error ? error.message : String(error)
      })
    )
  }
}
