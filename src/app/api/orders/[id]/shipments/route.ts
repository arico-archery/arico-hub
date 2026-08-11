import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/orders/[id]/shipments — 발송 회차 생성 (품목 단위 부분발송)
// body: { shippingDate: 'YYYY-MM-DD', trackingNo?: string, memo?: string,
//         items: [{ orderItemId, quantity }] }
// 수량은 품목의 미발송 잔량으로 캡. 생성 후 주문의 shippingDate/trackingNo 는
// 최신 회차 값으로 갱신(기존 화면·문서 호환), 전 품목 발송 완료면 status=shipped.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orderId = Number(id)
  const body = await req.json() as { shippingDate?: string; trackingNo?: string; memo?: string; items?: { orderItemId: number; quantity: number }[] }
  const reqItems = (body.items ?? []).filter(i => i.orderItemId && i.quantity > 0)
  if (!reqItems.length) return NextResponse.json({ error: 'items required' }, { status: 400 })

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { shipmentItems: true } }, shipments: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  // 품목별 미발송 잔량 계산 → 요청 수량 캡
  const itemById = new Map(order.items.map(it => [it.id, it]))
  const shipItems: { orderItemId: number; quantity: number }[] = []
  for (const r of reqItems) {
    const it = itemById.get(Number(r.orderItemId))
    if (!it) continue
    const shipped = it.shipmentItems.reduce((s, x) => s + x.quantity, 0)
    const remain = it.quantity - shipped
    const qty = Math.min(Number(r.quantity), remain)
    if (qty > 0) shipItems.push({ orderItemId: it.id, quantity: qty })
  }
  if (!shipItems.length) return NextResponse.json({ error: 'no shippable quantity' }, { status: 400 })

  const shippingDate = body.shippingDate ? new Date(body.shippingDate) : new Date()
  const shipNo = (order.shipments.reduce((m, s) => Math.max(m, s.shipNo), 0)) + 1
  const shipment = await prisma.shipment.create({
    data: {
      orderId, shipNo, shippingDate,
      trackingNo: (body.trackingNo ?? '').trim(),
      memo: (body.memo ?? '').trim(),
      items: { create: shipItems },
    },
    include: { items: true },
  })

  // 전 품목 발송 완료 여부
  const shippedNow = new Map<number, number>()
  for (const it of order.items) shippedNow.set(it.id, it.shipmentItems.reduce((s, x) => s + x.quantity, 0))
  for (const si of shipItems) shippedNow.set(si.orderItemId, (shippedNow.get(si.orderItemId) ?? 0) + si.quantity)
  const allShipped = order.items.every(it => (shippedNow.get(it.id) ?? 0) >= it.quantity)

  await prisma.order.update({
    where: { id: orderId },
    data: {
      shippingDate,
      ...(shipment.trackingNo ? { trackingNo: shipment.trackingNo } : {}),
      // 전량 발송 = 곧바로 완료 (2026-08-11 지안 결정: 배송완료 단계 폐지 — 발송이 끝이다).
      // 부분발송은 상태 유지.
      ...(allShipped && !['delivered', 'cancelled'].includes(order.status)
        ? { status: 'delivered', deliveryDate: shippingDate, completedAt: shippingDate }
        : {}),
    },
  })

  return NextResponse.json({ ok: true, shipment, allShipped })
}
