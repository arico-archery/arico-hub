import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createWithSeqRetry, nextPoNo } from '@/lib/seq'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supplier = searchParams.get('supplier') ?? ''
  const status   = searchParams.get('status') ?? ''
  const page     = Number(searchParams.get('page') ?? '1')
  const limit    = Number(searchParams.get('limit') ?? '30')
  const skip     = (page - 1) * limit

  // status는 쉼표 구분 다중 값 지원 (예: "ordered,partial,confirmed" = 입고 대기)
  const statusFilter = status.includes(',')
    ? { status: { in: status.split(',').map(s => s.trim()) } }
    : status ? { status } : {}
  const where = {
    ...(supplier ? { supplierCode: supplier } : {}),
    ...statusFilter,
  }

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: true,
        items: {
          include: { product: true },
        },
      },
      skip,
      take: limit,
      orderBy: { orderDate: 'desc' },
    }),
    prisma.purchaseOrder.count({ where }),
  ])

  return NextResponse.json({ orders, total, page, limit })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { supplierCode, items, expectedDate, memo } = body
  type ItemIn = { productId: number; quantity: number; unitCostJpy: number; memo?: string }
  const itemsIn = items as ItemIn[]

  // PO 번호: PO-YYYYMMDD-NNNN (동시성·삭제 안전 채번 + 충돌 재시도)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  // 원산지(origin)별 분리 — FIVICS 등 중국/한국 생산이 섞이면 발주처가 달라 별도 발주서 필요.
  // 상품 origin은 DB에서 조회(클라이언트 신뢰하지 않음).
  const prods = await prisma.product.findMany({
    where: { id: { in: itemsIn.map(i => i.productId) } },
    select: { id: true, origin: true },
  })
  const originById = new Map(prods.map(p => [p.id, p.origin || '']))

  const byOrigin = new Map<string, ItemIn[]>()
  for (const i of itemsIn) {
    const origin = originById.get(i.productId) || ''
    if (!byOrigin.has(origin)) byOrigin.set(origin, [])
    byOrigin.get(origin)!.push(i)
  }

  const created: { poNo: string; origin: string; itemCount: number }[] = []
  for (const [origin, groupItems] of byOrigin) {
    const totalCostJpy = groupItems.reduce((sum, i) => sum + i.unitCostJpy * i.quantity, 0)
    const originTag = origin ? `[${origin}] ` : ''
    const po = await createWithSeqRetry(
      (attempt) => nextPoNo(dateStr, attempt),
      (poNo) => prisma.purchaseOrder.create({
        data: {
          poNo,
          supplierCode,
          status: 'ordered',
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          memo: `${originTag}${memo ?? ''}`.trim(),
          totalCostJpy,
          items: {
            create: groupItems.map(i => ({
              productId:  i.productId,
              quantity:   i.quantity,
              unitCostJpy: i.unitCostJpy,
              memo:       i.memo ?? '',
            })),
          },
        },
      }),
    )
    created.push({ poNo: po.poNo, origin, itemCount: groupItems.length })
  }

  return NextResponse.json({ created }, { status: 201 })
}
