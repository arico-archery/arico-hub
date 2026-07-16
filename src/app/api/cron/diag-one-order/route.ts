import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAllOrdersDetailed, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 특정 주문의 MakeShop 원본을 확인하는 일회성 진단(운영자용). HMAC 보호.
// ?from=YYYYMMDD&to=YYYYMMDD&no=<systemOrderNumber>
// 확인 끝나면 이 파일은 지운다.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  const no = url.searchParams.get('no') || ''
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'from/to(YYYYMMDD) 필요' }, { status: 400 })
  }

  try {
    const orders = await getAllOrdersDetailed(`${from}000000`, `${to}235959`)
    const hit = no ? orders.filter(o => o.systemOrderNumber === no) : []
    // 그 기간 전체의 결제코드 분포도 함께 — 매핑에 없는 코드가 또 있는지 확인용
    const codeDist: Record<string, number> = {}
    for (const o of orders) codeDist[o.paymentStatusCode || '(빈값)'] = (codeDist[o.paymentStatusCode || '(빈값)'] || 0) + 1

    return NextResponse.json({
      ok: true,
      fetched: orders.length,
      codeDist,
      found: hit.length,
      order: hit[0] ?? null,
    })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
