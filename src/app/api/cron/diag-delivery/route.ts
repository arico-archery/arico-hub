import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopConfigured, getAllOrdersDetailed, fmtOrderDate } from '@/lib/makeshop'

export const maxDuration = 60

// 부분발송 진단(운영자용, HMAC). MakeShop 이 한 주문을 여러 배송(deliveryInfos)으로 쪼개 주는지,
// 각 배송이 자기 품목·송장·상태를 갖는지 실데이터로 확인한다. 읽기 전용.
//   ?from=YYYYMMDD&to=YYYYMMDD
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const now = new Date()
  const from = url.searchParams.get('from') || fmtOrderDate(new Date(now.getTime() - 60 * 86400000)).slice(0, 8)
  const to = url.searchParams.get('to') || fmtOrderDate(new Date(now.getTime() + 86400000)).slice(0, 8)
  const orders = await getAllOrdersDetailed(from + '000000', to + '235959')

  const byCount: Record<number, number> = {}
  const statusCount: Record<string, number> = {}
  let mixedStatus = 0          // 한 주문 안에서 배송 상태가 갈리는 것 = 부분발송
  const samples: unknown[] = []
  for (const o of orders) {
    const ds = o.deliveryInfos || []
    byCount[ds.length] = (byCount[ds.length] ?? 0) + 1
    const sts = new Set<string>()
    for (const d of ds) {
      const s = d.deliveryStatus || '(빈값)'
      statusCount[s] = (statusCount[s] ?? 0) + 1
      sts.add(s)
    }
    if (sts.size > 1) mixedStatus++
    if ((ds.length > 1 || sts.size > 1) && samples.length < 5) {
      samples.push({
        order: o.systemOrderNumber, date: o.orderDate,
        deliveries: ds.map(d => ({
          status: d.deliveryStatus, slip: d.slipNumber, date: d.deliveryDate,
          estimated: d.estimatedShipmentDate, charge: d.shippingCharge,
          items: (d.basketInfos || []).map(b => ({ name: (b.productName || '').slice(0, 30), qty: b.amount })),
        })),
      })
    }
  }
  return NextResponse.json({
    ok: true, from, to, orders: orders.length,
    배송건수별_주문수: byCount,
    배송상태_분포: statusCount,
    한주문내_상태가_갈리는_주문: mixedStatus,
    samples,
  })
}
