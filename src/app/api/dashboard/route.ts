import { NextResponse } from 'next/server'
import { getCachedDashboard } from '@/lib/dashboard'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const range = searchParams.get('range') ?? 'month'
  return NextResponse.json(await getCachedDashboard(range))
}
