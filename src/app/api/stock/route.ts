import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supplier = searchParams.get('supplier') ?? ''
  const lowOnly  = searchParams.get('lowOnly') === '1'

  const products = await prisma.product.findMany({
    where: {
      ...(supplier ? { supplierCode: supplier } : {}),
      ...(lowOnly ? { stockLevel: { isNot: null } } : {}),
    },
    include: {
      stockLevel: true,
      supplier: true,
    },
    orderBy: [{ supplierCode: 'asc' }, { name: 'asc' }],
    take: 500,
  })

  // 재고 부족 필터링 (재발주 기준 이하)
  const filtered = lowOnly
    ? products.filter(p => p.stockLevel && p.stockLevel.reorderPoint > 0 && p.stockLevel.quantity <= p.stockLevel.reorderPoint)
    : products

  return NextResponse.json(filtered)
}

export async function PATCH(req: Request) {
  const body = await req.json()
  const updates = body as { productId: number; quantity?: number; reservedQty?: number; reorderPoint?: number }[]

  await Promise.all(updates.map(u =>
    prisma.stockLevel.upsert({
      where: { productId: u.productId },
      create: {
        productId:    u.productId,
        quantity:     u.quantity     ?? 0,
        reservedQty:  u.reservedQty  ?? 0,
        reorderPoint: u.reorderPoint ?? 0,
      },
      update: {
        ...(u.quantity     !== undefined ? { quantity: u.quantity }         : {}),
        ...(u.reservedQty  !== undefined ? { reservedQty: u.reservedQty }   : {}),
        ...(u.reorderPoint !== undefined ? { reorderPoint: u.reorderPoint } : {}),
      },
    })
  ))

  return NextResponse.json({ updated: updates.length })
}
