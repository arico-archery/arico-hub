import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

// 수익 분석 집계 — 60초 캐시(무거운 groupBy/스캔 반복 방지)
async function buildAnalytics(rangeParam: string) {
  const now = new Date()

  // 기간 계산
  let monthCount = 6
  let startFrom: Date | null = null

  if (rangeParam === '12m') {
    monthCount = 12
  } else if (rangeParam === 'ytd') {
    // 올해 1월 1일부터
    startFrom = new Date(now.getFullYear(), 0, 1)
    monthCount = now.getMonth() + 1
  } else if (rangeParam === 'all') {
    // 가장 오래된 주문이 있는 달부터 — 24개월 고정이면 주문이 없는 달까지 빈 막대로 붙는다.
    const first = await prisma.order.findFirst({ orderBy: { orderDate: 'asc' }, select: { orderDate: true } })
    const d = first?.orderDate ?? now
    monthCount = Math.min(60, Math.max(1, (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) + 1))
  }

  const months = Array.from({ length: monthCount }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - i), 1)
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      start: d,
      end: new Date(d.getFullYear(), d.getMonth() + 1, 1),
    }
  })

  // 매출·통계에서 빼는 것
  //  - internal: 자사재고 주문 — 우리가 우리한테 파는 것이라 매출이 아님
  //  - cancelled: 취소 주문 — 매출도 아니고 받을 돈도 아님
  const SALES_EXCLUDE = { internal: false, status: { not: 'cancelled' } }
  const where = startFrom ? { orderDate: { gte: startFrom }, ...SALES_EXCLUDE } : { ...SALES_EXCLUDE }

  // 월별 데이터
  const monthlyData = await Promise.all(
    months.map(async m => {
      const agg = await prisma.order.aggregate({
        where: { orderDate: { gte: m.start, lt: m.end }, ...SALES_EXCLUDE },
        _sum: { totalAmountJpy: true, totalCostJpy: true },
        _count: true,
      })
      return {
        label: `${m.year}.${String(m.month).padStart(2, '0')}`,
        month: m.month,
        year: m.year,
        sales: agg._sum.totalAmountJpy ?? 0,
        cost: agg._sum.totalCostJpy ?? 0,
        count: agg._count,
      }
    })
  )

  // 전체 누적 통계
  const allTime = await prisma.order.aggregate({
    where,
    _sum: { totalAmountJpy: true, totalCostJpy: true },
    _count: true,
  })

  // 상품별 TOP 10
  const topItems = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: where },
    _sum: { salePriceJpy: true, costPriceJpy: true },
    _count: true,
    orderBy: { _sum: { salePriceJpy: 'desc' } },
    take: 50,
  })

  const productIds = topItems.map(i => i.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { supplier: true },
  })
  const productMap = Object.fromEntries(products.map(p => [p.id, p]))

  // 공급사별 / 브랜드별 매출
  const allOrderItems = await prisma.orderItem.findMany({
    where: { order: where },
    select: {
      salePriceJpy: true, costPriceJpy: true, quantity: true,
      product: { select: { supplierCode: true, brand: true } },
    },
  })
  const supplierStats: Record<string, { sales: number; cost: number }> = {}
  const brandAgg: Record<string, { sales: number; cost: number; qty: number }> = {}
  for (const item of allOrderItems) {
    const s = item.product.supplierCode
    if (!supplierStats[s]) supplierStats[s] = { sales: 0, cost: 0 }
    supplierStats[s].sales += item.salePriceJpy ?? 0
    supplierStats[s].cost += item.costPriceJpy ?? 0

    const b = (item.product.brand || '').trim() || '(미분류)'
    if (!brandAgg[b]) brandAgg[b] = { sales: 0, cost: 0, qty: 0 }
    brandAgg[b].sales += item.salePriceJpy ?? 0
    brandAgg[b].cost += item.costPriceJpy ?? 0
    brandAgg[b].qty += item.quantity ?? 0
  }
  // 브랜드별 매출
  const brandStats = Object.entries(brandAgg)
    .map(([brand, v]) => ({ brand, ...v }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 50)

  // 거래처별
  const topCustomers = await prisma.order.groupBy({
    by: ['customerId'],
    where,
    _sum: { totalAmountJpy: true, totalCostJpy: true, paidAmountJpy: true },
    _count: true,
    orderBy: { _sum: { totalAmountJpy: 'desc' } },
    take: 50,
  })
  const customerIds = topCustomers.map(c => c.customerId)
  const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } } })
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]))

  // 거래처별 미수금 분석 (미입금/부분입금 주문)
  const unpaidByCustomer = await prisma.order.groupBy({
    by: ['customerId'],
    where: { ...where, paymentStatus: { in: ['unpaid', 'partial'] } },
    _sum: { totalAmountJpy: true, paidAmountJpy: true },
    _count: true,
  })
  const recvCustomerIds = unpaidByCustomer.map(c => c.customerId)
  const recvCustomers = recvCustomerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: recvCustomerIds } } })
    : []
  const recvCustomerMap = Object.fromEntries(recvCustomers.map(c => [c.id, c]))
  // 연체(dueDate 지남) 미입금 주문 — 거래처별 연체액 집계
  const overdueUnpaid = await prisma.order.findMany({
    where: { ...where, paymentStatus: { in: ['unpaid', 'partial'] }, dueDate: { lt: now } },
    select: { customerId: true, totalAmountJpy: true, paidAmountJpy: true },
  })
  const overdueByCustomer: Record<number, number> = {}
  for (const o of overdueUnpaid) {
    overdueByCustomer[o.customerId] = (overdueByCustomer[o.customerId] ?? 0) + (o.totalAmountJpy - o.paidAmountJpy)
  }
  const receivables = unpaidByCustomer
    .map(c => {
      const balance = (c._sum.totalAmountJpy ?? 0) - (c._sum.paidAmountJpy ?? 0)
      return {
        customerId: c.customerId,
        name: recvCustomerMap[c.customerId]?.name ?? '-',
        company: recvCustomerMap[c.customerId]?.company ?? '',
        orderCount: c._count,
        balance,
        overdue: overdueByCustomer[c.customerId] ?? 0,
      }
    })
    .filter(r => r.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 50)
  const totalReceivable = receivables.reduce((s, r) => s + r.balance, 0)
  const totalOverdue = receivables.reduce((s, r) => s + r.overdue, 0)

  return {
    monthlyData,
    allTime: {
      sales: allTime._sum.totalAmountJpy ?? 0,
      cost: allTime._sum.totalCostJpy ?? 0,
      count: allTime._count,
    },
    topItems: topItems.map(i => ({
      productId: i.productId,
      count: i._count,
      sales: i._sum.salePriceJpy ?? 0,
      cost: i._sum.costPriceJpy ?? 0,
      product: productMap[i.productId] ?? null,
    })),
    supplierStats,
    brandStats,
    receivables,
    totalReceivable,
    totalOverdue,
    topCustomers: topCustomers.map(c => ({
      customerId: c.customerId,
      count: c._count,
      sales: c._sum.totalAmountJpy ?? 0,
      cost: c._sum.totalCostJpy ?? 0,
      paid: c._sum.paidAmountJpy ?? 0,
      customer: customerMap[c.customerId] ?? null,
    })),
  }
}

const getCachedAnalytics = unstable_cache(buildAnalytics, ['analytics'], { revalidate: 60 })

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rangeParam = searchParams.get('range') ?? '6m'
  return NextResponse.json(await getCachedAnalytics(rangeParam))
}
