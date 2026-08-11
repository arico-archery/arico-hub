import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcCostJpy } from '@/lib/utils'

// PATCH /api/order-items/[id] — 주문 항목 수정.
// ① productId 지정: 상품(변형) 교체 — 백오더 리스트에서 통합상품 → 선택한 변형으로 바꿀 때.
//    판매가는 고객 주문가라 유지하고, 원가(costPriceJpy)·옵션메모만 갱신 + 주문 원가합계 재계산.
// ② shopProductName / optionMemo / promisedDate / boMemo 만 지정: 표시 정보만 수정
//    (청구서 품명 편집, 백오더의 약속 납기·메모) — 원가·금액 불변.
//    shopProductName 은 이 주문에서의 표기명일 뿐, 상품 마스터 이름은 건드리지 않는다.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json() as {
    productId?: number; optionMemo?: string; shopProductName?: string
    promisedDate?: string | null; boMemo?: string
  }

  // ② 표시 정보만 수정
  if (!body.productId) {
    const flat = [body.shopProductName, body.optionMemo, body.promisedDate, body.boMemo]
    if (flat.every(v => v === undefined)) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }
    const item = await prisma.orderItem.update({
      where: { id: Number(id) },
      data: {
        ...(body.shopProductName !== undefined ? { shopProductName: body.shopProductName.trim().slice(0, 200) } : {}),
        ...(body.optionMemo !== undefined ? { optionMemo: body.optionMemo } : {}),
        // 빈 문자열/null 이면 날짜 지움
        ...(body.promisedDate !== undefined ? { promisedDate: body.promisedDate ? new Date(body.promisedDate) : null } : {}),
        ...(body.boMemo !== undefined ? { boMemo: body.boMemo.slice(0, 500) } : {}),
      },
    })
    return NextResponse.json(item)
  }

  // ① 상품(변형) 교체
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
