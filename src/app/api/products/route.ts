import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? ''
  const supplier = searchParams.get('supplier') ?? ''
  const category = searchParams.get('category') ?? ''
  const brand = searchParams.get('brand') ?? ''
  const categoriesOnly = searchParams.get('categoriesOnly') === '1'
  const brandsOnly = searchParams.get('brandsOnly') === '1'
  const page = Number(searchParams.get('page') ?? '1')
  const limit = Number(searchParams.get('limit') ?? '50')
  const skip = (page - 1) * limit

  // 공급사 통계 전용 요청 (count + latestScrapedAt)
  const statsOnly = searchParams.get('statsOnly') === '1'
  if (statsOnly && supplier) {
    const [total, latest] = await Promise.all([
      prisma.product.count({ where: { supplierCode: supplier } }),
      prisma.product.findFirst({
        where: { supplierCode: supplier, scrapedAt: { not: null } },
        orderBy: { scrapedAt: 'desc' },
        select: { scrapedAt: true },
      }),
    ])
    return NextResponse.json({ total, latestScrapedAt: latest?.scrapedAt ?? null })
  }

  // 카테고리 목록 전용 요청
  if (categoriesOnly) {
    const rows = await prisma.product.findMany({
      where: supplier ? { supplierCode: supplier } : {},
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    })
    const cats = rows.map(r => r.category).filter(Boolean)
    return NextResponse.json(cats)
  }

  // 브랜드 목록 전용 요청 (공급사별 distinct)
  if (brandsOnly) {
    const rows = await prisma.product.findMany({
      where: supplier ? { supplierCode: supplier } : {},
      select: { brand: true },
      distinct: ['brand'],
      orderBy: { brand: 'asc' },
    })
    return NextResponse.json(rows.map(r => r.brand).filter(Boolean))
  }

  const noPrice = searchParams.get('noPrice') === '1'

  const where = {
    ...(q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { brand: { contains: q, mode: 'insensitive' as const } },
        { productCode: { contains: q, mode: 'insensitive' as const } },
        { optionSize:  { contains: q, mode: 'insensitive' as const } },
        { optionColor: { contains: q, mode: 'insensitive' as const } },
      ]
    } : {}),
    ...(supplier ? { supplierCode: supplier } : {}),
    ...(category ? { category } : {}),
    ...(brand ? { brand } : {}),
    ...(noPrice ? { salePriceJpy: 0 } : {}),
  }

  const exportCsv = searchParams.get('format') === 'csv'

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { supplier: true },
      skip: exportCsv ? 0 : skip,
      take: exportCsv ? 9999 : limit,
      orderBy: [{ supplierCode: 'asc' }, { brand: 'asc' }, { name: 'asc' }],
    }),
    prisma.product.count({ where }),
  ])

  if (exportCsv) {
    const header = 'supplier,product_code,brand,category,name,cost_price,currency,sale_price_jpy'
    const rows = products.map(p => {
      const cols = [p.supplierCode, p.productCode, p.brand, p.category, `"${p.name.replace(/"/g, '""')}"`, p.costPrice, p.supplier.currency, p.salePriceJpy]
      return cols.join(',')
    })
    const csv = [header, ...rows].join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="products_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  return NextResponse.json({ products, total, page, limit })
}

// POST /api/products — 수동 상품 등록 (기타 브랜드 등)
export async function POST(req: Request) {
  const body = await req.json()
  const supplierCode = String(body.supplierCode || 'ETC')
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  // productCode 미입력 시 자동 생성 (공급사코드-타임스탬프)
  let productCode = String(body.productCode || '').trim()
  if (!productCode) productCode = `${supplierCode}-${Date.now().toString(36).toUpperCase()}`

  // 중복 방지 (supplierCode+productCode 유니크)
  const dup = await prisma.product.findUnique({
    where: { supplierCode_productCode: { supplierCode, productCode } },
  })
  if (dup) productCode = `${productCode}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`

  const product = await prisma.product.create({
    data: {
      supplierCode,
      productCode,
      name: String(body.name).trim(),
      brand: String(body.brand || '').trim(),
      category: String(body.category || '').trim(),
      costPrice: Number(body.costPrice) || 0,
      msrp: Number(body.msrp) || 0,
      salePriceJpy: Number(body.salePriceJpy) || 0,
      unit: String(body.unit || '1'),
      optionSize: String(body.optionSize || '').trim(),
      optionColor: String(body.optionColor || '').trim(),
      availability: String(body.availability || 'in_stock'),
    },
    include: { supplier: true },
  })
  return NextResponse.json(product, { status: 201 })
}

// PATCH /api/products  body: { updates: [{id, salePriceJpy}] }
export async function PATCH(req: Request) {
  const { updates } = await req.json() as { updates: { id: number; salePriceJpy: number }[] }
  if (!updates?.length) return NextResponse.json({ updated: 0 })

  await Promise.all(
    updates.map(({ id, salePriceJpy }) =>
      prisma.product.update({ where: { id }, data: { salePriceJpy } })
    )
  )
  return NextResponse.json({ updated: updates.length })
}
