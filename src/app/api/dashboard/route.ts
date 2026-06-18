import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

// 집계 데이터 — 60초 캐시(Vercel Data Cache). 콜드스타트/반복 진입 시 즉시 응답.
async function buildDashboard(range: string) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  // KPI 기간 + 비교 기간 산출
  let periodStart: Date | null
  let prevStart: Date | null = null
  let prevEnd: Date | null = null
  if (range === 'all') {
    periodStart = null
  } else if (range === '6m') {
    periodStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)   // 최근 6개월
    prevStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)    // 직전 6개월
    prevEnd = periodStart
  } else {
    periodStart = monthStart
    prevStart = prevMonthStart
    prevEnd = monthStart
  }
  const periodWhere = periodStart ? { orderDate: { gte: periodStart } } : {}
  const prevWhere = prevStart && prevEnd ? { orderDate: { gte: prevStart, lt: prevEnd } } : null

  const [
    monthOrders,
    prevMonthOrders,
    procureGroups,
    supplierPayableAgg,
    overduePOCount,
    unpaidOrders,
    pendingShipment,
    recentOrders,
    supplierStats,
    totalProducts,
    pricedProducts,
    unpricedGroups,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: periodWhere,
      _sum: { totalAmountJpy: true, totalCostJpy: true },
      _count: true,
    }),
    // 비교 기간 매출/이익 (증감 비교용)
    prevWhere
      ? prisma.order.aggregate({
          where: prevWhere,
          _sum: { totalAmountJpy: true, totalCostJpy: true },
          _count: true,
        })
      : Promise.resolve({ _sum: { totalAmountJpy: 0, totalCostJpy: 0 }, _count: 0 } as { _sum: { totalAmountJpy: number | null; totalCostJpy: number | null }; _count: number }),
    // 조달 상태별 주문 품목 집계 (백오더 요약)
    prisma.orderItem.groupBy({
      by: ['procureStatus'],
      _count: true,
    }),
    // 매입 지급 대기: 재고확인(confirmed) 됐으나 아직 미지급인 발주
    prisma.purchaseOrder.aggregate({
      where: { status: 'confirmed', paymentStatus: 'unpaid' },
      _sum: { confirmedTotalJpy: true },
      _count: true,
    }),
    // 입고 지연: 예상 입고일이 지났는데 아직 입고완료/취소가 아닌 발주
    prisma.purchaseOrder.count({
      where: { expectedDate: { lt: now }, status: { notIn: ['received', 'cancelled'] } },
    }),
    prisma.order.findMany({
      where: { paymentStatus: { in: ['unpaid', 'partial'] } },
      include: { customer: true },
      orderBy: { dueDate: 'asc' },
    }),
    prisma.order.count({
      where: { status: { in: ['confirmed', 'pending'] }, shippingDate: null },
    }),
    prisma.order.findMany({
      take: 10,
      include: {
        customer: true,
        items: { include: { product: { include: { supplier: true } } }, take: 3 },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.groupBy({
      by: ['supplierCode'],
      _count: true,
    }),
    prisma.product.count(),
    prisma.product.count({ where: { salePriceJpy: { gt: 0 } } }),
    // 공급사별 "판매가 미설정" 카운트 — 기존 클라이언트 8요청을 1쿼리로 통합
    prisma.product.groupBy({
      by: ['supplierCode'],
      where: { salePriceJpy: 0 },
      _count: true,
    }),
  ])

  const monthlySales = monthOrders._sum.totalAmountJpy ?? 0
  const monthlyCost = monthOrders._sum.totalCostJpy ?? 0
  const monthlyProfit = monthlySales - monthlyCost
  const monthlyOrderCount = monthOrders._count
  const monthlyMargin = monthlySales > 0 ? (monthlyProfit / monthlySales) * 100 : 0

  // 비교 기간 대비 증감
  const prevSales = prevMonthOrders._sum.totalAmountJpy ?? 0
  const prevCost = prevMonthOrders._sum.totalCostJpy ?? 0
  const prevProfit = prevSales - prevCost
  const prevMargin = prevSales > 0 ? (prevProfit / prevSales) * 100 : 0
  const salesMoM = prevSales > 0 ? ((monthlySales - prevSales) / prevSales) * 100 : null
  const profitMoM = prevProfit > 0 ? ((monthlyProfit - prevProfit) / prevProfit) * 100 : null
  const marginMoMPts = prevSales > 0 ? monthlyMargin - prevMargin : null  // 마진율 증감 (%p)

  // 조달 상태별 집계 (needed=미발주 / ordered=발주완료·입고대기 / received=입고완료)
  const procure = { needed: 0, ordered: 0, received: 0 } as Record<string, number>
  for (const g of procureGroups) {
    if (g.procureStatus in procure) procure[g.procureStatus] = g._count
  }

  const totalUnpaid = unpaidOrders.reduce(
    (acc, o) => acc + (o.totalAmountJpy - o.paidAmountJpy), 0
  )

  // 미결 중 연체 (dueDate 지남)
  const overdueOrders = unpaidOrders.filter(o => o.dueDate && new Date(o.dueDate) < now)

  return {
    monthlySales,
    monthlyProfit,
    monthlyMargin,
    monthlyOrderCount,
    salesMoM,
    profitMoM,
    marginMoMPts,
    procure,
    supplierPayable: {
      count: supplierPayableAgg._count,
      amount: supplierPayableAgg._sum.confirmedTotalJpy ?? 0,
    },
    overduePO: overduePOCount,
    totalUnpaid,
    pendingShipment,
    overdueCount: overdueOrders.length,
    unpaidOrders,
    recentOrders,
    supplierStats,
    totalProducts,
    pricedProducts,
    unpricedBySupplier: unpricedGroups.map(g => ({ supplierCode: g.supplierCode, _count: g._count })),
  }
}

const getCachedDashboard = unstable_cache(buildDashboard, ['dashboard'], { revalidate: 60 })

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const range = searchParams.get('range') ?? 'month'
  return NextResponse.json(await getCachedDashboard(range))
}
