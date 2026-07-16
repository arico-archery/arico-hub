import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/smaregi/inventory?q=&page=&limit= — 스마레지 재고 캐시 조회(로그인 필요).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit')) || 50))
  const lowOnly = searchParams.get('lowOnly') === '1'   // 재고 부족(≤0)만

  const where = {
    ...(q ? { OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { productCode: { contains: q, mode: 'insensitive' as const } },
      { size: { contains: q, mode: 'insensitive' as const } },
    ] } : {}),
    ...(lowOnly ? { stock: { lte: 0 } } : {}),
  }

  const [rows, total, lastSync, stats] = await Promise.all([
    prisma.smaregiProduct.findMany({ where, orderBy: [{ name: 'asc' }], skip: (page - 1) * limit, take: limit }),
    prisma.smaregiProduct.count({ where }),
    prisma.smaregiProduct.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
    prisma.smaregiProduct.aggregate({ _count: true, _sum: { stock: true } }),
  ])

  return NextResponse.json({
    rows, total, page, limit,
    lastSync: lastSync?.syncedAt ?? null,
    totalProducts: stats._count, totalStock: stats._sum.stock ?? 0,
  })
}
