import { NextResponse } from 'next/server'
import { getModelModes } from '@/lib/models'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ modes: getModelModes() })
}
