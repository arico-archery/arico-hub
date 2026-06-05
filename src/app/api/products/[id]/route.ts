import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// PATCH /api/products/[id] — 단일 상품 수정 (수동 등록 상품 편집)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const data: Record<string, unknown> = {}
  if (body.name !== undefined)        data.name        = String(body.name).trim()
  if (body.brand !== undefined)       data.brand       = String(body.brand).trim()
  if (body.category !== undefined)    data.category    = String(body.category).trim()
  if (body.productCode !== undefined) data.productCode = String(body.productCode).trim()
  if (body.costPrice !== undefined)   data.costPrice   = Number(body.costPrice) || 0
  if (body.msrp !== undefined)        data.msrp        = Number(body.msrp) || 0
  if (body.salePriceJpy !== undefined)data.salePriceJpy= Number(body.salePriceJpy) || 0
  if (body.unit !== undefined)        data.unit        = String(body.unit || '1')
  if (body.optionSize !== undefined)  data.optionSize  = String(body.optionSize).trim()
  if (body.optionColor !== undefined) data.optionColor = String(body.optionColor).trim()
  if (body.availability !== undefined)data.availability= String(body.availability)

  const product = await prisma.product.update({
    where: { id: Number(id) },
    data,
    include: { supplier: true },
  })
  return NextResponse.json(product)
}

// DELETE /api/products/[id] — 단일 상품 삭제 (주문/발주에 사용된 상품은 차단)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const productId = Number(id)

  const [orderUse, poUse] = await Promise.all([
    prisma.orderItem.count({ where: { productId } }),
    prisma.purchaseOrderItem.count({ where: { productId } }),
  ])
  if (orderUse > 0 || poUse > 0) {
    return NextResponse.json(
      { error: 'in_use', orderUse, poUse },
      { status: 409 },
    )
  }

  // 카탈로그 매칭/재고 정리 후 삭제
  await prisma.aricoCatalog.updateMany({ where: { supplierProductId: productId }, data: { supplierProductId: null } })
  await prisma.stockLevel.deleteMany({ where: { productId } })
  await prisma.product.delete({ where: { id: productId } })
  return NextResponse.json({ ok: true })
}
