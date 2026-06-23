import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcCostJpy } from '@/lib/utils'

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

    // 공급가(엔화 환산) 계산용 환율
    const rates = await prisma.exchangeRate.findMany({ select: { currency: true, rateToJpy: true } })

    const rowsWithMatch = rows.map(r => {
      const mp = r.supplierProductId ? (productMap[r.supplierProductId] ?? null) : null
      return {
        ...r,
        matchedProduct: mp,
        // 매칭된 공급사 상품의 원가를 엔화로 환산한 공급가 (미매칭은 null)
        supplyCostJpy: mp ? Math.round(calcCostJpy(mp, rates)) : null,
      }
    })

    return NextResponse.json({ rows: rowsWithMatch, total })
  } catch (err) {
    console.error('arico-catalog error:', err)
    return NextResponse.json({ rows: [], total: 0 })
  }
}

// POST /api/arico-catalog — 수동(이벤트/일시) 상품 추가. productCode 자동생성 EVENT-xxxx.
export async function POST(req: Request) {
  const body = await req.json() as { name?: string; brand?: string; priceJpy?: number; point?: number; imageUrl1?: string }
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const price = Math.round(body.priceJpy ?? 0) || 0
  const created = await prisma.aricoCatalog.create({
    data: {
      productCode: `EVENT-${Date.now().toString(36).toUpperCase()}`,
      name: body.name.trim(),
      brand: (body.brand ?? '').trim(),
      priceJpy: price,
      priceJpyNotax: price ? Math.round(price / 1.1) : 0,
      point: Math.round(body.point ?? 0) || 0,
      imageUrl1: (body.imageUrl1 ?? '').trim(),
    },
  })
  return NextResponse.json(created, { status: 201 })
}

// PATCH /api/arico-catalog — { id, supplierProductId?, barcode?, name?, brand?, priceJpy?, point?, imageUrl1? }
export async function PATCH(req: Request) {
  const body = await req.json() as {
    id: number; supplierProductId?: number | null; barcode?: string
    name?: string; brand?: string; priceJpy?: number; point?: number; imageUrl1?: string
  }
  const { id } = body

  const data: { supplierProductId?: number | null; barcode?: string; name?: string; brand?: string; priceJpy?: number; priceJpyNotax?: number; point?: number; imageUrl1?: string } = {}
  if ('supplierProductId' in body) data.supplierProductId = body.supplierProductId
  if (body.barcode !== undefined) data.barcode = body.barcode.trim()
  // 수동(이벤트) 상품 필드 편집
  if (body.name !== undefined) data.name = body.name.trim()
  if (body.brand !== undefined) data.brand = body.brand.trim()
  if (body.priceJpy !== undefined) { data.priceJpy = Math.round(body.priceJpy) || 0; data.priceJpyNotax = Math.round((Math.round(body.priceJpy) || 0) / 1.1) }
  if (body.point !== undefined) data.point = Math.round(body.point) || 0
  if (body.imageUrl1 !== undefined) data.imageUrl1 = body.imageUrl1.trim()

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
