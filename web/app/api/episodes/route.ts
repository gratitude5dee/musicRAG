import { NextResponse } from 'next/server'
import { getDb, publicMongoError } from '@/lib/mongodb'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const entity = url.searchParams.get('entity')
    const type = url.searchParams.get('type')
    const db = await getDb()
    const match = entity && type ? { [`${type}s`]: entity } : {}
    const episodes = await db
      .collection('episodes')
      .find(match, {
        projection: {
          _id: 0,
          video_id: 1,
          title: 1,
          channel: 1,
          upload_date: 1,
          guests: 1,
          topics: 1,
          chunk_count: 1,
          video_url: 1
        }
      })
      .sort({ upload_ts: -1 })
      .limit(50)
      .toArray()
    return NextResponse.json({ episodes })
  } catch (error) {
    const message = publicMongoError(error)
    console.error(JSON.stringify({ level: 'error', msg: 'episodes_failed', route: '/api/episodes', error: message }))
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
