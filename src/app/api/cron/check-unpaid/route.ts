import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getAllOrdersDetailed, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이, 현재 미입금 주문들의 MakeShop 실제 코드·배송상태를 대조(진단용). HMAC 보호.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from') || '20260101'
  const to = url.searchParams.get('to') || '20260714'
  try {
    const orders = await getAllOrdersDetailed(`${from}000000`, `${to}235959`)
    const ms = new Map(orders.map(o => [o.systemOrderNumber, {
      code: o.paymentStatusCode,
      del: (o.deliveryInfos || [])[0]?.deliveryStatus || '',
      slip: (o.deliveryInfos || [])[0]?.slipNumber || '',
    }]))
    const unpaid = await prisma.order.findMany({
      where: { paymentStatus: 'unpaid' },
      select: { orderNo: true, externalOrderNo: true, status: true, totalAmountJpy: true },
      orderBy: { orderDate: 'desc' },
    })
    // 코드별 집계
    const byCode: Record<string, number> = {}
    const rows = unpaid.map(o => {
      const m = ms.get(o.externalOrderNo)
      const code = m?.code ?? '(MS미조회)'
      byCode[code] = (byCode[code] || 0) + 1
      return { orderNo: o.orderNo, ourStatus: o.status, amount: o.totalAmountJpy, msCode: code, msDelivery: m?.del ?? '', msSlip: m?.slip ?? '' }
    })
    return NextResponse.json({ ok: true, unpaidTotal: unpaid.length, byCode, rows: rows.slice(0, 60) })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
