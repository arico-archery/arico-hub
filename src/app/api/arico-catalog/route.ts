import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  // 매칭율 요약 통계 (stats=1)
  if (searchParams.get('stats') === '1') {
    try {
      const [total, matched, matchedRows] = await Promise.all([
        prisma.aricoCatalog.count(),
        prisma.aricoCatalog.count({ where: { supplierProductId: { not: null } } }),
        prisma.aricoCatalog.findMany({
          where: { supplierProductId: { not: null } },
          select: { supplierProduct: { select: { supplierCode: true } } },
        }),
      ])
      const bySupplier: Record<string, number> = {}
      for (const r of matchedRows) {
        const c = r.supplierProduct?.supplierCode
        if (c) bySupplier[c] = (bySupplier[c] ?? 0) + 1
      }
      return NextResponse.json({ total, matched, unmatched: total - matched, bySupplier })
    } catch (err) {
      console.error('arico-catalog stats error:', err)
      return NextResponse.json({ total: 0, matched: 0, unmatched: 0, bySupplier: {} })
    }
  }

  const q = searchParams.get('q') ?? ''
  const limit = Number(searchParams.get('limit') ?? '50')
  const offset = Number(searchParams.get('offset') ?? '0')
  const matchedOnly = searchParams.get('matchedOnly') === '1'
  const unmatchedOnly = searchParams.get('unmatchedOnly') === '1'

  try {
    const textWhere = q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { brand: { contains: q, mode: 'insensitive' as const } }, { productCode: { contains: q, mode: 'insensitive' as const } }] }
      : {}
    const matchWhere = matchedOnly
      ? { supplierProductId: { not: null } }
      : unmatchedOnly
      ? { supplierProductId: null }
      : {}
    const where = { ...textWhere, ...matchWhere }

    const [rows, total] = await Promise.all([
      prisma.aricoCatalog.findMany({
        where,
        orderBy: [{ brand: 'asc' }, { name: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.aricoCatalog.count({ where }),
    ])

    // 매칭된 공급사 상품 정보 조회
    const productIds = rows.map(r => r.supplierProductId).filter((id): id is number => id != null)
    const products = productIds.length > 0
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true, name: true, brand: true, productCode: true, supplierCode: true,
            costPrice: true, salePriceJpy: true, unit: true, optionSize: true, optionColor: true,
            supplier: { select: { currency: true, taxRate: true, discount: true } },
          },
        })
      : []
    const productMap = Object.fromEntries(products.map(p => [p.id, p]))

    const rowsWithMatch = rows.map(r => ({
      ...r,
      matchedProduct: r.supplierProductId ? (productMap[r.supplierProductId] ?? null) : null,
    }))

    return NextResponse.json({ rows: rowsWithMatch, total })
  } catch (err) {
    console.error('arico-catalog error:', err)
    return NextResponse.json({ rows: [], total: 0 })
  }
}

// PATCH /api/arico-catalog — { id, supplierProductId: number | null }
export async function PATCH(req: Request) {
  const { id, supplierProductId } = await req.json() as { id: number; supplierProductId: number | null }

  const catalog = await prisma.aricoCatalog.update({ where: { id }, data: { supplierProductId } })

  // 매칭 시 ARICO 카탈로그 판매가를 공급사 상품 salePriceJpy에 자동 반영
  let priceJpyApplied = 0
  if (supplierProductId && catalog.priceJpy > 0) {
    await prisma.product.update({
      where: { id: supplierProductId },
      data: { salePriceJpy: catalog.priceJpy },
    })
    priceJpyApplied = catalog.priceJpy
  }

  return NextResponse.json({ ok: true, priceJpyApplied })
}
