import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAllOrdersDetailed, fmtOrderDate, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 paymentStatusCode 분포·샘플을 진단(운영자용). HMAC(AUTH_SECRET) 보호.
// token = hex(HMAC-SHA256(AUTH_SECRET, 'import-orders')) — 기존 cron과 동일 토큰.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 365))
  const per = Math.min(10, Math.max(1, Number(url.searchParams.get('per')) || 5))
  const now = new Date()
  const start = fmtOrderDate(new Date(now.getTime() - days * 86400000))
  const end = fmtOrderDate(now)
  try {
    const orders = await getAllOrdersDetailed(start, end)
    // 코드별 그룹핑
    const groups: Record<string, { count: number; samples: { order: string; date: string; sum: number; member: string }[] }> = {}
    for (const o of orders) {
      const code = o.paymentStatusCode || '(빈값)'
      const g = groups[code] || (groups[code] = { count: 0, samples: [] })
      g.count++
      if (g.samples.length < per) {
        g.samples.push({
          order: o.displayOrderNumber || o.systemOrderNumber,
          date: o.orderDate,
          sum: Number(o.sumPrice) || 0,
          member: o.memberId,
        })
      }
    }
    const summary = Object.entries(groups)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([code, g]) => ({ code, count: g.count, samples: g.samples }))
    return NextResponse.json({ ok: true, range: { start, end }, total: orders.length, codes: summary })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
