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

  const where = {
    ...(supplier ? { supplierCode: supplier } : {}),
    ...(status   ? { status } : {}),
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

  // PO 번호: PO-YYYYMMDD-NNNN (동시성·삭제 안전 채번 + 충돌 재시도)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  // 총 원가 계산
  const totalCostJpy = (items as { unitCostJpy: number; quantity: number }[])
    .reduce((sum, i) => sum + i.unitCostJpy * i.quantity, 0)

  const po = await createWithSeqRetry(
    (attempt) => nextPoNo(dateStr, attempt),
    (poNo) => prisma.purchaseOrder.create({
      data: {
        poNo,
        supplierCode,
        status: 'ordered',
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        memo: memo ?? '',
        totalCostJpy,
        items: {
          create: (items as { productId: number; quantity: number; unitCostJpy: number; memo?: string }[]).map(i => ({
            productId:  i.productId,
            quantity:   i.quantity,
            unitCostJpy: i.unitCostJpy,
            memo:       i.memo ?? '',
          })),
        },
      },
      include: {
        supplier: true,
        items: { include: { product: true } },
      },
    }),
  )

  return NextResponse.json(po, { status: 201 })
}
