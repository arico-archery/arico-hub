import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// DELETE /api/shipments/[id] — 발송 회차 삭제(오입력 정정용).
// 주문의 shippingDate/trackingNo 는 남은 최신 회차 값으로 되돌린다(없으면 비움).
// 상태는 자동으로 되돌리지 않는다(shipped 해제는 주문 화면에서 수동).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const shipment = await prisma.shipment.findUnique({ where: { id: Number(id) }, select: { id: true, orderId: true } })
  if (!shipment) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.shipment.delete({ where: { id: shipment.id } })   // items 는 cascade

  const latest = await prisma.shipment.findFirst({ where: { orderId: shipment.orderId }, orderBy: { shipNo: 'desc' } })
  await prisma.order.update({
    where: { id: shipment.orderId },
    data: latest
      ? { shippingDate: latest.shippingDate, trackingNo: latest.trackingNo }
      : { shippingDate: null, trackingNo: '' },
  })
  return NextResponse.json({ ok: true })
}
