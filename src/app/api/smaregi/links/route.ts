import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcCostJpy } from '@/lib/utils'

// SKU 3단 연결(카탈로그 → 스마레지 SKU → 공급사 변형) 관리 API.
// GET  /api/smaregi/links?filter=sold|sold-unlinked|no-catalog|linked|all&q=&limit=&offset=
//   - sold: 주문 이력에 등장한 SKU 만 — 실제 작업 대상(~700)으로 좁힌다
//   - no-catalog: 판매이력은 있는데 카탈로그가 안 붙은 것 (공급사 확정 이전 단계라 별도로 본다)
//   - 각 행에 카탈로그·확정된 공급사 변형·판매횟수를 붙여 반환
// PATCH { id, supplierProductId }  — 사람이 확정/해제(null). catalogId 도 같이 바꿀 수 있다.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const filter = searchParams.get('filter') ?? 'sold'
  const q = (searchParams.get('q') ?? '').trim()
  const limit = Math.min(200, Number(searchParams.get('limit')) || 50)
  const offset = Number(searchParams.get('offset')) || 0

  // 판매 이력: 주문 품목 옵션코드별 등장 횟수
  const memoRows = await prisma.orderItem.findMany({
    where: { optionMemo: { not: '' } },
    select: { optionMemo: true },
  })
  const soldCount = new Map<string, number>()
  for (const r of memoRows) {
    const m = String(r.optionMemo).match(/\d{10,14}/)
    if (m) soldCount.set(m[0], (soldCount.get(m[0]) ?? 0) + 1)
  }

  const where: Record<string, unknown> = {}
  if (filter === 'unlinked') where.supplierProductId = null
  if (filter === 'linked') where.supplierProductId = { not: null }
  if (q) where.OR = [
    { name: { contains: q, mode: 'insensitive' } },
    { productCode: { contains: q } },
  ]

  // sold 필터는 코드 목록이 커서 in 절 대신 전체 조회 후 걸러낸다(1.5만행, select 최소화라 가볍다)
  const rows = await prisma.smaregiProduct.findMany({
    where,
    select: {
      id: true, productCode: true, name: true, size: true, color: true,
      price: true, stock: true, catalogId: true, supplierProductId: true,
    },
    orderBy: { name: 'asc' },
  })
  let list = rows.map(r => ({ ...r, sold: soldCount.get(r.productCode) ?? 0 }))
  if (filter === 'sold') list = list.filter(r => r.sold > 0)
  // 미확정 = 카탈로그는 붙었는데 공급사 변형이 아직인 것. 카탈로그부터 없는 건 아래 no-catalog 로 분리한다
  if (filter === 'sold-unlinked') list = list.filter(r => r.sold > 0 && r.supplierProductId == null && r.catalogId != null)
  if (filter === 'no-catalog') list = list.filter(r => r.sold > 0 && r.catalogId == null)
  list.sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name))
  const total = list.length
  const page = list.slice(offset, offset + limit)

  // 카탈로그·공급사 정보 부착
  const catIds = [...new Set(page.map(r => r.catalogId).filter((v): v is number => v != null))]
  const supIds = [...new Set(page.map(r => r.supplierProductId).filter((v): v is number => v != null))]
  const [cats, sups, rates] = await Promise.all([
    catIds.length ? prisma.aricoCatalog.findMany({ where: { id: { in: catIds } },
      select: { id: true, name: true, priceJpy: true, supplierProductId: true,
        supplierProduct: { select: { id: true, name: true, supplierCode: true } } } }) : [],
    supIds.length ? prisma.product.findMany({ where: { id: { in: supIds } },
      select: { id: true, name: true, brand: true, supplierCode: true, productCode: true, costPrice: true, optionSize: true, optionColor: true,
        supplier: { select: { currency: true, taxRate: true, discount: true } } } }) : [],
    prisma.exchangeRate.findMany(),
  ])
  const catMap = new Map(cats.map(c => [c.id, c]))
  const supMap = new Map(sups.map(s => [s.id, s]))
  const out = page.map(r => {
    const cat = r.catalogId ? catMap.get(r.catalogId) : null
    const sup = r.supplierProductId ? supMap.get(r.supplierProductId) : null
    return {
      ...r,
      catalog: cat ? { id: cat.id, name: cat.name, priceJpy: cat.priceJpy, supplierProductId: cat.supplierProductId,
        groupSupplier: cat.supplierProduct ? { id: cat.supplierProduct.id, name: cat.supplierProduct.name, supplierCode: cat.supplierProduct.supplierCode } : null } : null,
      supplierProduct: sup ? { id: sup.id, name: sup.name, supplierCode: sup.supplierCode, productCode: sup.productCode,
        optionSize: sup.optionSize, optionColor: sup.optionColor,
        costJpy: calcCostJpy(sup, rates) } : null,
    }
  })
  return NextResponse.json({ rows: out, total })
}

export async function PATCH(req: Request) {
  const body = await req.json() as { id: number; supplierProductId?: number | null; catalogId?: number | null }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const data: Record<string, number | null> = {}
  if (body.supplierProductId !== undefined) data.supplierProductId = body.supplierProductId
  if (body.catalogId !== undefined) data.catalogId = body.catalogId
  if (!Object.keys(data).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  const row = await prisma.smaregiProduct.update({ where: { id: body.id }, data })
  return NextResponse.json({ ok: true, id: row.id, supplierProductId: row.supplierProductId, catalogId: row.catalogId })
}
