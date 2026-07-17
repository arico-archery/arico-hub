import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/smaregi/inventory?q=&page=&limit= — 스마레지 재고 캐시 조회(로그인 필요).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50))
  // 재고 필터: all(전체) | in(있음 >0) | low(없음·부족 ≤0)
  // lowOnly=1 은 예전 파라미터 — 기존 링크·북마크가 깨지지 않게 함께 받는다.
  const stockRaw = searchParams.get('stock') ?? (searchParams.get('lowOnly') === '1' ? 'low' : 'all')
  const stockFilter = stockRaw === 'in' ? { stock: { gt: 0 } }
    : stockRaw === 'low' ? { stock: { lte: 0 } }
    : {}

  const category = (searchParams.get('category') ?? '').trim()   // 部門名 정확일치

  const where = {
    ...(q ? { OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { productCode: { contains: q, mode: 'insensitive' as const } },
      { size: { contains: q, mode: 'insensitive' as const } },
    ] } : {}),
    ...stockFilter,
    ...(category ? { category } : {}),
  }

  const [rows, total, lastSync, stats, catGroups] = await Promise.all([
    prisma.smaregiProduct.findMany({ where, orderBy: [{ name: 'asc' }], skip: (page - 1) * limit, take: limit }),
    prisma.smaregiProduct.count({ where }),
    prisma.smaregiProduct.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
    prisma.smaregiProduct.aggregate({ _count: true, _sum: { stock: true } }),
    // 部門 목록 — 자주 쓰는 것이 위로 오게 건수 내림차순(101종이라 드롭다운으로 고른다)
    prisma.smaregiProduct.groupBy({ by: ['category'], _count: true, orderBy: { _count: { category: 'desc' } } }),
  ])

  return NextResponse.json({
    rows, total, page, limit,
    lastSync: lastSync?.syncedAt ?? null,
    totalProducts: stats._count, totalStock: stats._sum.stock ?? 0,
    categories: catGroups.filter(c => c.category).map(c => ({ name: c.category, count: c._count })),
  })
}
