import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

type EditItem = { productId: number; quantity: number; salePriceJpy: number; costPriceJpy: number; optionMemo?: string }

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const orderId = Number(id)

  // 품목 편집(추가/삭제/수정): items 배열이 오면 기존 품목 전체 교체 + 합계 재계산
  if (Array.isArray(body.items)) {
    let totalAmountJpy = 0
    let totalCostJpy = 0
    const itemsData = (body.items as EditItem[]).map(it => {
      totalAmountJpy += it.salePriceJpy * it.quantity
      totalCostJpy += it.costPriceJpy * it.quantity
      return {
        productId: it.productId, quantity: it.quantity,
        salePriceJpy: it.salePriceJpy, costPriceJpy: it.costPriceJpy,
        optionMemo: it.optionMemo ?? '',
      }
    })
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { orderId } }),
      prisma.order.update({
        where: { id: orderId },
        data: { totalAmountJpy, totalCostJpy, items: { create: itemsData } },
      }),
    ])
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: {
      ...(body.customerId        !== undefined && { customerId: Number(body.customerId) }),
      ...(body.status            !== undefined && { status: body.status }),
      ...(body.paymentStatus     !== undefined && { paymentStatus: body.paymentStatus }),
      ...(body.paidAmountJpy     !== undefined && { paidAmountJpy: Number(body.paidAmountJpy) }),
      ...(body.paymentDate       !== undefined && { paymentDate: new Date(body.paymentDate) }),
      ...(body.shippingDate      !== undefined && { shippingDate: new Date(body.shippingDate) }),
      ...(body.deliveryDate      !== undefined && { deliveryDate: new Date(body.deliveryDate) }),
      ...(body.trackingNo        !== undefined && { trackingNo: body.trackingNo }),
      ...(body.memo              !== undefined && { memo: body.memo }),
      ...(body.dueDate           !== undefined && { dueDate: body.dueDate ? new Date(body.dueDate) : null }),
      ...(body.delayNotifyDate   !== undefined && { delayNotifyDate: body.delayNotifyDate ? new Date(body.delayNotifyDate) : null }),
      // 배송완료 → completedAt 자동 기록
      ...(body.status === 'delivered' && { deliveryDate: new Date(), completedAt: new Date() }),
      // 완료 취소 (상태 되돌리기)
      ...(body.status !== undefined && body.status !== 'delivered' && { completedAt: null }),
      // 수동 완료 처리
      ...(body.completedAt !== undefined && { completedAt: body.completedAt ? new Date(body.completedAt) : null }),
    },
    include: {
      customer: true,
      items: { select: { procureStatus: true } },
    },
  })

  return NextResponse.json(order)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.order.delete({ where: { id: Number(id) } })
  return NextResponse.json({ ok: true })
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await prisma.order.findUnique({
    where: { id: Number(id) },
    include: {
      customer: true,
      items: { include: { product: { include: { supplier: true } } } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(order)
}
