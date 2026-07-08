import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const STATUS_KEY = 'makeshop_import_status'

// 최근 주문 수신의 진행상태를 반환(탭 이동/새로고침에도 유지).
// { state: 'idle'|'running'|'done'|'error', startedAt, finishedAt, created, dup, partial, error }
export async function GET() {
  const row = await prisma.setting.findUnique({ where: { key: STATUS_KEY } })
  if (!row?.value) return NextResponse.json({ state: 'idle' })
  try {
    return NextResponse.json(JSON.parse(row.value))
  } catch {
    return NextResponse.json({ state: 'idle' })
  }
}
