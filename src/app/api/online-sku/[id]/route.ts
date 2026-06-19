import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// PATCH /api/online-sku/[id] — 재고/필드 수정 (수동)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const data: Record<string, unknown> = {}
  if (body.barcode !== undefined)      data.barcode = String(body.barcode).trim()
  if (body.name !== undefined)         data.name = String(body.name).trim()
  if (body.optionLabel !== undefined)  data.optionLabel = String(body.optionLabel).trim()
  if (body.stockQty !== undefined)     data.stockQty = Number(body.stockQty) || 0
  if (body.reorderPoint !== undefined) data.reorderPoint = Number(body.reorderPoint) || 0
  if (body.catalogId !== undefined)    data.catalogId = body.catalogId != null ? Number(body.catalogId) : null
  if (body.supplierProductId !== undefined) data.supplierProductId = body.supplierProductId != null ? Number(body.supplierProductId) : null

  const sku = await prisma.onlineSku.update({ where: { id: Number(id) }, data })
  return NextResponse.json(sku)
}

// DELETE /api/online-sku/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.onlineSku.delete({ where: { id: Number(id) } })
  return NextResponse.json({ ok: true })
}
