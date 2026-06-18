import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcCostJpy } from '@/lib/utils'

// PATCH /api/order-items/[id] — 주문 항목의 상품(변형) 교체.
// 백오더 리스트에서 통합상품 → 선택한 변형(색상/사이즈)으로 바꿀 때 사용.
// 판매가는 고객 주문가라 유지하고, 원가(costPriceJpy)·옵션메모만 갱신 + 주문 원가합계 재계산.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as { productId?: number; optionMemo?: string }
  if (!body.productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const [product, rates] = await Promise.all([
    prisma.product.findUnique({ where: { id: Number(body.productId) }, include: { supplier: true } }),
    prisma.exchangeRate.findMany(),
  ])
  if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 })

  const costJpy = calcCostJpy(product, rates)
  const item = await prisma.orderItem.update({
    where: { id: Number(id) },
    data: {
      productId: product.id,
      costPriceJpy: costJpy,
      ...(body.optionMemo !== undefined ? { optionMemo: body.optionMemo } : {}),
    },
    include: { product: { include: { supplier: true } } },
  })

  // 주문 원가합계 재계산 (판매가/총액은 불변)
  const siblings = await prisma.orderItem.findMany({ where: { orderId: item.orderId }, select: { costPriceJpy: true, quantity: true } })
  const totalCostJpy = siblings.reduce((s, i) => s + i.costPriceJpy * i.quantity, 0)
  await prisma.order.update({ where: { id: item.orderId }, data: { totalCostJpy } })

  return NextResponse.json(item)
}
