import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/products/bulk-price
// body: { supplierCode?, category?, q?, marginPct: number, noPriceOnly?: boolean }
// 서버에서 환율 읽어 마진율 기반 판매가 일괄 계산 후 업데이트
export async function POST(req: Request) {
  const body = await req.json()
  const { supplierCode, category, q, marginPct, noPriceOnly } = body as {
    supplierCode?: string
    category?: string
    q?: string
    marginPct: number
    noPriceOnly?: boolean
  }

  if (!marginPct || marginPct <= 0 || marginPct >= 100) {
    return NextResponse.json({ error: 'marginPct must be between 1 and 99' }, { status: 400 })
  }

  // 환율 로드
  const rates = await prisma.exchangeRate.findMany()
  const rateMap = Object.fromEntries(rates.map(r => [r.currency, r.rateToJpy]))

  // 대상 상품 조회
  const where = {
    ...(supplierCode ? { supplierCode } : {}),
    ...(category ? { category } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { brand: { contains: q } }, { productCode: { contains: q } }] } : {}),
    ...(noPriceOnly ? { salePriceJpy: 0 } : {}),
  }

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      costPrice: true,
      supplier: { select: { currency: true, taxRate: true, discount: true } },
    },
  })

  // 판매가 계산
  const updates: { id: number; salePriceJpy: number }[] = []
  for (const p of products) {
    const rate = rateMap[p.supplier.currency] ?? 1
    let price = p.costPrice
    if (p.supplier.taxRate > 0) price = price / (1 + p.supplier.taxRate)
    if (p.supplier.discount > 0 && p.supplier.discount < 1) price = price * p.supplier.discount
    const costJpy = Math.round(price * rate)
    if (costJpy <= 0) continue
    // salePrice = costJpy / (1 - margin/100), 10엔 단위 올림
    const salePrice = Math.ceil(costJpy / (1 - marginPct / 100) / 10) * 10
    updates.push({ id: p.id, salePriceJpy: salePrice })
  }

  if (updates.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  // 100개씩 배치 업데이트
  const BATCH = 100
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH)
    await Promise.all(
      batch.map(u => prisma.product.update({ where: { id: u.id }, data: { salePriceJpy: u.salePriceJpy } }))
    )
  }

  return NextResponse.json({ updated: updates.length, total: products.length })
}
