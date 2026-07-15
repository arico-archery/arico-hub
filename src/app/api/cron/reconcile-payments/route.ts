import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getAllOrdersDetailed, makeshopConfigured, MakeshopError } from '@/lib/makeshop'
import { PAID_CODES } from '@/app/api/makeshop/import-orders/route'

export const maxDuration = 60

// 로그인 없이 기존 주문의 입금상태를 최신 코드매핑으로 재정리(운영자용). HMAC(AUTH_SECRET) 보호.
// MakeShop에서 구간 주문의 paymentStatusCode를 다시 받아, DB 주문(externalOrderNo=systemOrderNumber)의
// paymentStatus를 PAID_CODES 기준으로 보정. 취소(배송상태)는 건드리지 않음.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from'); const to = url.searchParams.get('to')
  if (!from || !/^\d{8}$/.test(from) || !to || !/^\d{8}$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'from/to(YYYYMMDD) 필요' }, { status: 400 })
  }
  const dry = url.searchParams.get('dry') === '1'
  try {
    const orders = await getAllOrdersDetailed(`${from}000000`, `${to}235959`)
    // systemOrderNumber → 결제코드
    const codeByOrder = new Map<string, string>()
    for (const o of orders) codeByOrder.set(o.systemOrderNumber, o.paymentStatusCode)

    // DB에서 해당 주문들 조회
    const dbOrders = await prisma.order.findMany({
      where: { externalOrderNo: { in: [...codeByOrder.keys()] } },
      select: { id: true, externalOrderNo: true, paymentStatus: true, status: true, paidAmountJpy: true, totalAmountJpy: true, orderDate: true },
    })
    let toPaid = 0, toUnpaid = 0, toCancelled = 0, unchanged = 0
    const updates: { id: number; data: Record<string, unknown> }[] = []
    for (const o of dbOrders) {
      const code = codeByOrder.get(o.externalOrderNo)!
      // 0003 = 취소 → 주문상태 cancelled (결제는 미입금 유지)
      if (code === '0003') {
        if (o.status === 'cancelled') { unchanged++; continue }
        toCancelled++
        updates.push({ id: o.id, data: { status: 'cancelled', paymentStatus: 'unpaid', paidAmountJpy: 0 } })
        continue
      }
      const desired = PAID_CODES.has(code) ? 'paid' : 'unpaid'
      if (o.paymentStatus === desired) { unchanged++; continue }
      if (desired === 'paid') {
        toPaid++
        updates.push({ id: o.id, data: { paymentStatus: 'paid', paidAmountJpy: o.totalAmountJpy, paymentDate: o.orderDate } })
      } else {
        toUnpaid++
        updates.push({ id: o.id, data: { paymentStatus: 'unpaid', paidAmountJpy: 0, paymentDate: null } })
      }
    }
    if (!dry) {
      const CONC = 10
      for (let i = 0; i < updates.length; i += CONC) {
        await Promise.allSettled(updates.slice(i, i + CONC).map(u => prisma.order.update({ where: { id: u.id }, data: u.data })))
      }
    }
    return NextResponse.json({ ok: true, dry, fetched: orders.length, matchedInDb: dbOrders.length, toPaid, toUnpaid, toCancelled, unchanged })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
