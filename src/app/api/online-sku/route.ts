import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 50

// GET /api/online-sku?q=&page=&lowOnly=1
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const lowOnly = searchParams.get('lowOnly') === '1'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)

  const where = {
    ...(q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { optionLabel: { contains: q, mode: 'insensitive' as const } },
        { barcode: { contains: q, mode: 'insensitive' as const } },
      ],
    } : {}),
    ...(lowOnly ? { stockQty: { lte: 0 } } : {}),
  }

  const [rows, total, agg] = await Promise.all([
    prisma.onlineSku.findMany({ where, orderBy: [{ name: 'asc' }, { optionLabel: 'asc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.onlineSku.count({ where }),
    prisma.onlineSku.aggregate({ _sum: { stockQty: true }, _count: true }),
  ])

  return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE, totalSkus: agg._count, totalStock: agg._sum.stockQty ?? 0 })
}

// POST /api/online-sku — 수동 SKU 등록
export async function POST(req: Request) {
  const body = await req.json()
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const sku = await prisma.onlineSku.create({
    data: {
      barcode: String(body.barcode || '').trim(),
      name: String(body.name).trim(),
      optionLabel: String(body.optionLabel || '').trim(),
      stockQty: Number(body.stockQty) || 0,
      reorderPoint: Number(body.reorderPoint) || 0,
      catalogId: body.catalogId != null ? Number(body.catalogId) : null,
      supplierProductId: body.supplierProductId != null ? Number(body.supplierProductId) : null,
      source: 'manual',
    },
  })
  return NextResponse.json(sku, { status: 201 })
}
