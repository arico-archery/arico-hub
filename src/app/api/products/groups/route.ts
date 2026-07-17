import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { groupKeyOf, commonBaseName, sibuyaBaseName } from '@/lib/variants'

const PAGE_SIZE = 50

type GroupRow = {
  groupCode: string; base: string; brand: string; category: string; supplierCode: string
  count: number; repId: number; minSale: number; maxSale: number
  pricedCount: number; inStockCount: number
}

// 슬림하게 불러와 코드 접두부로 그룹핑. (무거운 단계만 캐시)
// q(검색어)는 DB 이름 필터로 먼저 줄인다 — JVD 변형은 베이스명을 공유하므로
// 베이스/브랜드로 검색하면 그룹이 쪼개지지 않는다(전체 스캔 회피, 매칭 모달 속도↑).
async function buildGroups(supplier: string, category: string, brand: string, q: string): Promise<GroupRow[]> {
  const rows = await prisma.product.findMany({
    where: {
      ...(supplier ? { supplierCode: supplier } : {}),
      ...(category ? { category } : {}),
      ...(brand ? { brand } : {}),
      // 공백으로 토큰 분리 → 모든 토큰을 AND로 포함 검색.
      // 예: "Diamond bow" → name에 Diamond AND bow 둘 다 포함(비연속 가능)되면 매칭.
      ...(q ? { AND: q.split(/\s+/).filter(Boolean).map((term) => ({ name: { contains: term, mode: 'insensitive' as const } })) } : {}),
    },
    select: {
      id: true, productCode: true, name: true, brand: true, category: true,
      supplierCode: true, salePriceJpy: true, availability: true, optionSize: true, optionColor: true,
    },
    orderBy: { name: 'asc' },
  })

  const map = new Map<string, typeof rows>()
  for (const r of rows) {
    const gc = groupKeyOf(r)
    if (!map.has(gc)) map.set(gc, [])
    map.get(gc)!.push(r)
  }

  const groups: GroupRow[] = []
  for (const [gc, vs] of map) {
    const sales = vs.map(v => v.salePriceJpy).filter(p => p > 0)
    const base = vs[0].supplierCode === 'SHIBUYA'
      ? sibuyaBaseName(vs[0].name, vs[0].optionSize, vs[0].optionColor)
      : (commonBaseName(vs.map(v => v.name)) || vs[0].name)
    groups.push({
      groupCode: gc,
      base: base || vs[0].name,
      brand: vs[0].brand,
      category: vs[0].category,
      supplierCode: vs[0].supplierCode,
      count: vs.length,
      repId: vs[0].id,
      minSale: sales.length ? Math.min(...sales) : 0,
      maxSale: sales.length ? Math.max(...sales) : 0,
      pricedCount: sales.length,
      inStockCount: vs.filter(v => v.availability === 'in_stock').length,
    })
  }
  groups.sort((a, b) => a.base.localeCompare(b.base))
  return groups
}

const getCachedGroups = (supplier: string, category: string, brand: string, q: string) =>
  unstable_cache(
    () => buildGroups(supplier, category, brand, q),
    ['product-groups', supplier, category, brand, q],
    { revalidate: 60 },
  )()

// GET /api/products/groups?supplier=JVD&q=&category=&brand=&noPrice=&page=1
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supplier = searchParams.get('supplier') || ''
  const category = searchParams.get('category') || ''
  const brand = searchParams.get('brand') || ''
  const q = (searchParams.get('q') || '').trim().toLowerCase()
  const noPrice = searchParams.get('noPrice') === '1'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)

  let groups = await getCachedGroups(supplier, category, brand, q)
  if (noPrice) groups = groups.filter(g => g.pricedCount < g.count)

  const total = groups.length
  const start = (page - 1) * PAGE_SIZE
  const pageGroups = groups.slice(start, start + PAGE_SIZE)

  return NextResponse.json({ groups: pageGroups, total, page, pageSize: PAGE_SIZE })
}
