import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { groupCodeOf, commonBaseName } from '@/lib/variants'

const PAGE_SIZE = 50

type GroupRow = {
  groupCode: string; base: string; brand: string; category: string; supplierCode: string
  count: number; repId: number; minSale: number; maxSale: number
  pricedCount: number; inStockCount: number
}

// 공급사 한정으로 슬림하게 불러와 코드 접두부로 그룹핑. (무거운 단계만 캐시)
async function buildGroups(supplier: string, category: string, brand: string): Promise<GroupRow[]> {
  const rows = await prisma.product.findMany({
    where: {
      ...(supplier ? { supplierCode: supplier } : {}),
      ...(category ? { category } : {}),
      ...(brand ? { brand } : {}),
    },
    select: {
      id: true, productCode: true, name: true, brand: true, category: true,
      supplierCode: true, salePriceJpy: true, availability: true,
    },
    orderBy: { name: 'asc' },
  })

  const map = new Map<string, typeof rows>()
  for (const r of rows) {
    const gc = groupCodeOf(r.supplierCode, r.productCode)
    if (!map.has(gc)) map.set(gc, [])
    map.get(gc)!.push(r)
  }

  const groups: GroupRow[] = []
  for (const [gc, vs] of map) {
    const sales = vs.map(v => v.salePriceJpy).filter(p => p > 0)
    groups.push({
      groupCode: gc,
      base: commonBaseName(vs.map(v => v.name)) || vs[0].name,
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

const getCachedGroups = (supplier: string, category: string, brand: string) =>
  unstable_cache(
    () => buildGroups(supplier, category, brand),
    ['product-groups', supplier, category, brand],
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

  let groups = await getCachedGroups(supplier, category, brand)
  if (q) groups = groups.filter(g => g.base.toLowerCase().includes(q) || g.groupCode.toLowerCase().includes(q))
  if (noPrice) groups = groups.filter(g => g.pricedCount < g.count)

  const total = groups.length
  const start = (page - 1) * PAGE_SIZE
  const pageGroups = groups.slice(start, start + PAGE_SIZE)

  return NextResponse.json({ groups: pageGroups, total, page, pageSize: PAGE_SIZE })
}
