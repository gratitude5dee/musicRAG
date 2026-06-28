import { NextResponse } from 'next/server'
import { getDb } from '@/lib/mongodb'

export const runtime = 'nodejs'

export async function GET() {
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
}

