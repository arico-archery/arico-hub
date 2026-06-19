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
            id: true, name: true, brand: true, productCode: true, supplierCode: true, category: true,
            costPrice: true, salePriceJpy: true, unit: true, optionSize: true, optionColor: true,
            supplier: { select: { currency: true, taxRate: true, discount: true } },
          },
        })
      : []
    const productMap = Object.fromEntries(products.map(p => [p.id, p]))

    // 각 카탈로그의 온라인샵 변형(OnlineSku) 재고
    const catalogIds = rows.map(r => r.id)
    const skus = catalogIds.length > 0
      ? await prisma.onlineSku.findMany({ where: { catalogId: { in: catalogIds } }, orderBy: { optionLabel: 'asc' } })
      : []
    const skuMap: Record<number, typeof skus> = {}
    for (const s of skus) { if (s.catalogId != null) (skuMap[s.catalogId] ??= []).push(s) }

    const rowsWithMatch = rows.map(r => {
      const variants = skuMap[r.id] ?? []
      return {
        ...r,
        matchedProduct: r.supplierProductId ? (productMap[r.supplierProductId] ?? null) : null,
        variants,
        stockTotal: variants.reduce((sum, v) => sum + v.stockQty, 0),
      }
    })

    return NextResponse.json({ rows: rowsWithMatch, total })
  } catch (err) {
    console.error('arico-catalog error:', err)
    return NextResponse.json({ rows: [], total: 0 })
  }
}

// PATCH /api/arico-catalog — { id, supplierProductId?: number | null, barcode?: string }
export async function PATCH(req: Request) {
  const body = await req.json() as { id: number; supplierProductId?: number | null; barcode?: string }
  const { id } = body

  const data: { supplierProductId?: number | null; barcode?: string } = {}
  if ('supplierProductId' in body) data.supplierProductId = body.supplierProductId
  if (body.barcode !== undefined) data.barcode = body.barcode.trim()

  const catalog = await prisma.aricoCatalog.update({ where: { id }, data })

  // 매칭 시 ARICO 카탈로그 판매가를 공급사 상품 salePriceJpy에 자동 반영
  let priceJpyApplied = 0
  if (data.supplierProductId && catalog.priceJpy > 0) {
    await prisma.product.update({
      where: { id: data.supplierProductId },
      data: { salePriceJpy: catalog.priceJpy },
    })
    priceJpyApplied = catalog.priceJpy
  }

  // 바코드(JAN)를 매칭된 공급사 상품에도 전파 → 양쪽에서 Smaregi 재고 조회 가능
  if (body.barcode !== undefined && catalog.supplierProductId) {
    await prisma.product.update({
      where: { id: catalog.supplierProductId },
      data: { barcode: body.barcode.trim() },
    }).catch(() => { /* 삭제된 상품 등 무시 */ })
  }

  return NextResponse.json({ ok: true, priceJpyApplied })
}
