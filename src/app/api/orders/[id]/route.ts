import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { planAllocation, FROM_STOCK, type StockItemInput } from '@/lib/stock'

type EditItem = { productId: number; quantity: number; salePriceJpy: number; costPriceJpy: number; optionMemo?: string }

const adjustStock = (productId: number, delta: number) =>
  prisma.stockLevel.upsert({
    where: { productId },
    create: { productId, quantity: delta },
    update: { quantity: { increment: delta } },
  })

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const orderId = Number(id)

  const current = await prisma.order.findUnique({
    where: { id: orderId },
    select: { shippingDate: true, items: { select: { productId: true, quantity: true, procureStatus: true } } },
  })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 품목 편집(추가/삭제/수정): 기존 품목 전체 교체 + 합계 재계산 + 재고 재배정
  if (Array.isArray(body.items)) {
    // 기존 from_stock 차감분을 가용재고에 되돌린 상태에서 신규 품목을 재배정한다
    const oldFromStock: Record<number, number> = {}
    for (const it of current.items) {
      if (it.procureStatus === FROM_STOCK) oldFromStock[it.productId] = (oldFromStock[it.productId] ?? 0) + it.quantity
    }
    const pids = [...new Set([...current.items.map(i => i.productId), ...(body.items as EditItem[]).map(i => i.productId)])]
    const stocks = await prisma.stockLevel.findMany({ where: { productId: { in: pids } } })
    const stockMap: Record<number, number> = {}
    for (const s of stocks) stockMap[s.productId] = s.quantity + (oldFromStock[s.productId] ?? 0)

    const plan = planAllocation(body.items as StockItemInput[], stockMap)
    let totalAmountJpy = 0
    let totalCostJpy = 0
    const itemsData = plan.items.map(it => {
      totalAmountJpy += it.salePriceJpy * it.quantity
      totalCostJpy += it.costPriceJpy * it.quantity
      return {
        productId: it.productId, quantity: it.quantity,
        salePriceJpy: it.salePriceJpy, costPriceJpy: it.costPriceJpy,
        optionMemo: it.optionMemo ?? '', procureStatus: it.procureStatus,
      }
    })

    // 순 재고 변화 = 되돌린 옛 from_stock − 새 from_stock 차감
    const netDelta: Record<number, number> = { ...oldFromStock }
    for (const [pid, q] of Object.entries(plan.decrements)) netDelta[Number(pid)] = (netDelta[Number(pid)] ?? 0) - q

    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { orderId } }),
      prisma.order.update({ where: { id: orderId }, data: { totalAmountJpy, totalCostJpy, items: { create: itemsData } } }),
      ...Object.entries(netDelta).filter(([, d]) => d !== 0).map(([pid, d]) => adjustStock(Number(pid), d)),
    ])
  }

  // 발송 처리(미발송 → 발송): 발주분(received) 재고 차감 (입고 때 늘어난 재고가 빠져나감)
  const shippingNow = body.shippingDate !== undefined && body.shippingDate && !current.shippingDate
  if (shippingNow && !Array.isArray(body.items)) {
    const recv = current.items.filter(i => i.procureStatus === 'received')
    if (recv.length > 0) {
      await prisma.$transaction(recv.map(i => adjustStock(i.productId, -i.quantity)))
    }
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
  const orderId = Number(id)
  // 미발송 from_stock 품목의 차감 재고를 되돌린다 (발송분은 이미 빠진 것으로 간주)
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { shippingDate: true, items: { select: { productId: true, quantity: true, procureStatus: true } } },
  })
  const restores = (order && !order.shippingDate)
    ? order.items.filter(i => i.procureStatus === FROM_STOCK)
    : []
  await prisma.$transaction([
    ...restores.map(i => adjustStock(i.productId, i.quantity)),
    prisma.order.delete({ where: { id: orderId } }),
  ])
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
