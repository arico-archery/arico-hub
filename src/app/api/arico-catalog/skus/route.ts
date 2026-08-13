import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcCostJpy } from '@/lib/utils'

// 카탈로그 1건에 매달린 스마레지 SKU 목록 (3단 연결의 가운데 층을 카탈로그 관점에서 본다).
// GET /api/arico-catalog/skus?catalogId=123
//   → { skus: [...], candidates: [...] }
//     skus       = 이미 이 카탈로그에 연결된 SKU (판매횟수·재고·확정된 공급사 변형 포함)
//     candidates = 아직 어느 카탈로그에도 안 붙었는데 이름이 겹치는 SKU (붙일 후보)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const catalogId = Number(searchParams.get('catalogId'))
  if (!catalogId) return NextResponse.json({ skus: [], candidates: [] })

  const cat = await prisma.aricoCatalog.findUnique({
    where: { id: catalogId },
    select: { id: true, name: true, barcode: true, supplierProductId: true },
  })
  if (!cat) return NextResponse.json({ skus: [], candidates: [] })

  // 판매 횟수(옵션코드 기준)
  const memoRows = await prisma.orderItem.findMany({ where: { optionMemo: { not: '' } }, select: { optionMemo: true } })
  const sold = new Map<string, number>()
  for (const r of memoRows) {
    const m = String(r.optionMemo).match(/\d{10,14}/)
    if (m) sold.set(m[0], (sold.get(m[0]) ?? 0) + 1)
  }

  const linked = await prisma.smaregiProduct.findMany({
    where: { catalogId },
    select: { id: true, productCode: true, name: true, size: true, color: true, price: true, stock: true, supplierProductId: true },
    orderBy: { name: 'asc' },
  })

  // 후보: 미연결 SKU 중 이름이 겹치는 것. 카탈로그명의 의미있는 토큰으로 좁힌다.
  const norm = (s: string) => String(s || '').normalize('NFKC').replace(/【[^】]*】/g, '').replace(/[（）()]/g, ' ').trim()
  const tokens = norm(cat.name).split(/[\s　]+/).filter(t => t.length >= 2).slice(0, 2)
  const candidates = tokens.length
    ? await prisma.smaregiProduct.findMany({
        where: {
          catalogId: null,
          AND: tokens.map(t => ({ name: { contains: t, mode: 'insensitive' as const } })),
        },
        select: { id: true, productCode: true, name: true, size: true, color: true, price: true, stock: true, supplierProductId: true },
        take: 40,
        orderBy: { name: 'asc' },
      })
    : []

  // 확정된 공급사 변형 정보 부착
  const supIds = [...new Set([...linked, ...candidates].map(r => r.supplierProductId).filter((v): v is number => v != null))]
  const [sups, rates] = await Promise.all([
    supIds.length ? prisma.product.findMany({
      where: { id: { in: supIds } },
      select: { id: true, name: true, brand: true, supplierCode: true, costPrice: true, optionSize: true, optionColor: true,
        supplier: { select: { currency: true, taxRate: true, discount: true } } },
    }) : [],
    prisma.exchangeRate.findMany(),
  ])
  const supMap = new Map(sups.map(s => [s.id, s]))
  const deco = (r: typeof linked[number]) => {
    const sup = r.supplierProductId ? supMap.get(r.supplierProductId) : null
    return {
      ...r,
      sold: sold.get(r.productCode) ?? 0,
      supplierProduct: sup
        ? { id: sup.id, name: sup.name, supplierCode: sup.supplierCode, optionSize: sup.optionSize, optionColor: sup.optionColor, costJpy: calcCostJpy(sup, rates) }
        : null,
    }
  }
  return NextResponse.json({
    catalog: { id: cat.id, name: cat.name, supplierProductId: cat.supplierProductId },
    skus: linked.map(deco),
    candidates: candidates.map(deco),
  })
}
