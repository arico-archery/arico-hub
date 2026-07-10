import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { runImport } from '@/app/api/makeshop/import-orders/route'

export const maxDuration = 60

// 로그인 없이 MakeShop 수신을 트리거(운영자/스케줄러용).
// AUTH_SECRET 기반 HMAC 토큰으로 보호 — token = hex(HMAC-SHA256(AUTH_SECRET, 'import-orders'))
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 180))
  // 명시 구간(from/to = YYYYMMDD)이 있으면 그 구간만 — 월 단위로 나눠 대량 타임아웃 회피.
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to')
  const win = (from && /^\d{8}$/.test(from) && to && /^\d{8}$/.test(to)) ? { start: `${from}000000`, end: `${to}235959` } : undefined
  const result = await runImport(days, win)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
