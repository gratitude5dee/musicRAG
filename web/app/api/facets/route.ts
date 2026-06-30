import { NextResponse } from 'next/server'
import { getDb, publicMongoError } from '@/lib/mongodb'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const db = await getDb()
    const [channels, guests, topics] = await Promise.all([
      db.collection('channels').find({}, { projection: { _id: 0 } }).sort({ channel: 1 }).toArray(),
      db
        .collection('entities')
        .find({ type: 'guest' }, { projection: { _id: 0, name: 1, slug: 1, episode_count: 1 } })
        .sort({ episode_count: -1, name: 1 })
        .limit(150)
        .toArray(),
      db
        .collection('entities')
        .find({ type: 'topic' }, { projection: { _id: 0, name: 1, slug: 1, episode_count: 1 } })
        .sort({ episode_count: -1, name: 1 })
        .limit(150)
        .toArray()
    ])
    return NextResponse.json({ channels, guests, topics })
  } catch (error) {
    const message = publicMongoError(error)
    console.error(JSON.stringify({ level: 'error', msg: 'facets_failed', route: '/api/facets', error: message }))
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
