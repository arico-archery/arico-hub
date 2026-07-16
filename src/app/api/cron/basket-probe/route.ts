import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAllOrdersDetailed, makeshopConfigured } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 특정 주문의 basket 원본을 통째로 덤프(진단). HMAC 보호.
// ?from=YYYYMMDD&to=YYYYMMDD [&sys=systemOrderNumber]
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const okAuth = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!okAuth) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from') || '20260222'
  const to = url.searchParams.get('to') || '20260222'
  const sys = url.searchParams.get('sys') || ''
  const orders = await getAllOrdersDetailed(`${from}000000`, `${to}235959`)
  const hit = orders.filter(o => !sys || o.systemOrderNumber === sys)
  return NextResponse.json({
    ok: true, matched: hit.length,
    orders: hit.slice(0, 3).map(o => ({
      sys: o.systemOrderNumber,
      baskets: (o.deliveryInfos || []).flatMap(d => d.basketInfos || []),
    })),
  })
}
