import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createWithSeqRetry } from '@/lib/seq'
import { calcDiscount } from '@/lib/utils'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') ?? ''
  const paymentStatus = searchParams.get('paymentStatus') ?? ''
  const customerId = searchParams.get('customerId')
  const page = Number(searchParams.get('page') ?? '1')
  const limit = Number(searchParams.get('limit') ?? '30')
  const skip = (page - 1) * limit

  const q          = searchParams.get('q') ?? ''
  const completed  = searchParams.get('completed') ?? ''   // '1'=완료만, '0'=진행중만
  const readyToShip = searchParams.get('readyToShip') ?? '' // '1'=전 품목 입고완료 & 미발송(배송대기)
  const from       = searchParams.get('from') ?? ''         // 주문일 시작(ISO) — 완료 탭 기간 스코프
  const to         = searchParams.get('to') ?? ''
  const orderDateFilter: { gte?: Date; lte?: Date } = {}
  if (from && !isNaN(Date.parse(from))) orderDateFilter.gte = new Date(from)
  if (to && !isNaN(Date.parse(to))) orderDateFilter.lte = new Date(to)

  // paymentStatus는 쉼표 구분 다중 값 지원 (예: "unpaid,partial")
  const paymentStatusFilter = paymentStatus.includes(',')
    ? { paymentStatus: { in: paymentStatus.split(',').map(s => s.trim()) } }
    : paymentStatus ? { paymentStatus } : {}

  // 조건을 AND 배열로 조립 — OR/status 키 충돌 방지(완료필터·검색이 각각 OR을 쓸 수 있음)
  const and: Record<string, unknown>[] = []
  if (status) and.push({ status })
  // 취소 주문 제외 — 입금관리처럼 "받을 돈"만 봐야 하는 화면용.
  // (완료 탭은 취소를 일부러 포함하므로 기본값은 제외하지 않는다)
  if (searchParams.get('excludeCancelled') === '1') and.push({ status: { not: 'cancelled' } })
  if (Object.keys(paymentStatusFilter).length) and.push(paymentStatusFilter)
  if (customerId) and.push({ customerId: Number(customerId) })
  // 완료 필터: '1'=완료(배송완료) 또는 취소, '0'=진행중(완료 안 됨 & 취소 아님)
  if (completed === '1') and.push({ OR: [{ completedAt: { not: null } }, { status: 'cancelled' }] })
  if (completed === '0') and.push({ completedAt: null }, { status: { not: 'cancelled' } })
  if (Object.keys(orderDateFilter).length) and.push({ orderDate: orderDateFilter })
  // 배송대기: 모든 주문품목이 입고완료(received)인데 아직 미발송
  if (readyToShip === '1') and.push({ shippingDate: null, items: { some: {}, every: { procureStatus: 'received' } } })
  if (q) and.push({ OR: [
    { orderNo: { contains: q, mode: 'insensitive' as const } },
    { customer: { name: { contains: q, mode: 'insensitive' as const } } },
    { customer: { company: { contains: q, mode: 'insensitive' as const } } },
    { memo: { contains: q, mode: 'insensitive' as const } },
  ] })
  const where = and.length ? { AND: and } : {}

  const exportCsv = searchParams.get('format') === 'csv'

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        customer: true,
        items: { include: { product: { include: { supplier: true } } } },
      },
      skip: exportCsv ? 0 : skip,
      take: exportCsv ? 9999 : limit,
      orderBy: { orderDate: 'desc' },
    }),
    prisma.order.count({ where }),
  ])

  if (exportCsv) {
    const header = 'order_no,order_date,customer,company,status,payment_status,total_jpy,cost_jpy,paid_jpy,unpaid_jpy,margin_pct,shipping_date,tracking_no,memo'
    const rows = orders.map(o => {
      const margin = o.totalAmountJpy > 0 ? (((o.totalAmountJpy - o.totalCostJpy) / o.totalAmountJpy) * 100).toFixed(1) : '0'
      const unpaid = o.totalAmountJpy - o.paidAmountJpy
      return [
        o.orderNo,
        new Date(o.orderDate).toLocaleDateString('ja-JP'),
        `"${o.customer.name}"`,
        `"${o.customer.company}"`,
        o.status,
        o.paymentStatus,
        o.totalAmountJpy,
        o.totalCostJpy,
        o.paidAmountJpy,
        unpaid,
        margin,
        o.shippingDate ? new Date(o.shippingDate).toLocaleDateString('ja-JP') : '',
        o.trackingNo,
        `"${o.memo.replace(/"/g, '""')}"`,
      ].join(',')
    })
    const csv = [header, ...rows].join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  // 주문 품목에 ARICO 카탈로그 대표 이미지 첨부 (공급사 상품 매칭 기준)
  const productIds = [...new Set(orders.flatMap(o => o.items.map(it => it.productId)))]
  const catImgMap: Record<number, string> = {}
  if (productIds.length > 0) {
    const cats = await prisma.aricoCatalog.findMany({
      where: { supplierProductId: { in: productIds }, NOT: { imageUrl1: '' } },
      select: { supplierProductId: true, imageUrl1: true },
    })
    for (const c of cats) {
      if (c.supplierProductId != null && !catImgMap[c.supplierProductId]) {
        catImgMap[c.supplierProductId] = c.imageUrl1
      }
    }
  }
  const ordersWithImg = orders.map(o => ({
    ...o,
    items: o.items.map(it => ({ ...it, catalogImage: catImgMap[it.productId] ?? '' })),
  }))

  return NextResponse.json({ orders: ordersWithImg, total, page, limit })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { items, memo, dueDate } = body
  const internal = body.internal === true

  // 自社在庫(재고확보용) 주문이면 전용 거래처(code=SELF)를 자동 사용/생성
  let customerId = body.customerId
  if (internal) {
    const self = await prisma.customer.upsert({
      where: { code: 'SELF' },
      update: {},
      create: { code: 'SELF', name: 'ARICO（自社在庫）', company: 'ARICO', customerType: 'corporation' },
      select: { id: true },
    })
    customerId = self.id
  }

  // 주문번호: ORD-YYYYMMDD-NNNN. 현존 최대 일련번호 기준 + 충돌 시 재시도(동시성·삭제 안전)
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')

  // Calculate totals
  type OrderItemInput = {
    productId: number; quantity: number; salePriceJpy: number
    costPriceJpy: number; optionMemo?: string; catalogId?: number | null
  }
  let subtotalJpy = 0
  let totalCostJpy = 0
  const itemsData = (items as OrderItemInput[]).map((item) => {
    subtotalJpy += item.salePriceJpy * item.quantity
    totalCostJpy += item.costPriceJpy * item.quantity
    return {
      productId: item.productId,
      quantity: item.quantity,
      salePriceJpy: item.salePriceJpy,
      costPriceJpy: item.costPriceJpy,
      optionMemo: item.optionMemo ?? '',
    }
  })

  // 할인: 본문에 값이 오면 사용(주문별 수정), 없으면 거래처 기본 할인 적용.
  let discountRate = Number(body.discountRate)
  let discountAmount = Number(body.discountAmount)
  if (!Number.isFinite(discountRate) || !Number.isFinite(discountAmount)) {
    const cust = await prisma.customer.findUnique({
      where: { id: Number(customerId) },
      select: { discountRate: true, discountAmount: true },
    })
    if (!Number.isFinite(discountRate)) discountRate = cust?.discountRate ?? 0
    if (!Number.isFinite(discountAmount)) discountAmount = cust?.discountAmount ?? 0
  }
  const discountValue = calcDiscount(subtotalJpy, discountRate, discountAmount)
  const totalAmountJpy = subtotalJpy - discountValue

  const order = await createWithSeqRetry(
    async (attempt) => {
      const last = await prisma.order.findFirst({ orderBy: { id: 'desc' }, select: { orderNo: true } })
      const lastSeq = last ? (parseInt(last.orderNo.split('-').pop() || '0', 10) || 0) : 0
      return `ORD-${dateStr}-${String(lastSeq + 1 + attempt).padStart(4, '0')}`
    },
    (orderNo) => prisma.order.create({
      data: {
        orderNo,
        customerId: Number(customerId),
        internal,
        // 자사재고 주문은 청구 대상이 아님 → 미수금 방지 위해 입금완료로 표시
        paymentStatus: internal ? 'paid' : 'unpaid',
        memo: memo ?? '',
        dueDate: internal ? null : (dueDate ? new Date(dueDate) : null),
        subtotalJpy,
        discountRate,
        discountAmount,
        totalAmountJpy,
        totalCostJpy,
        items: { create: itemsData },
      },
      include: {
        customer: true,
        items: { include: { product: true } },
      },
    }),
  )

  // 주문에서 사람이 확정한 정보를 공급사 상품 / ARICO 카탈로그에 역반영한다.
  // 주문이 쌓일수록 판매가·매칭이 실제 거래 기준으로 점점 정확해진다.
  // (자사재고 주문은 판매가가 아니므로 역반영하지 않는다)
  for (const item of internal ? [] : items as OrderItemInput[]) {
    // 1) 공급사 상품 판매가가 비어있으면(0) 주문 판매가로 채운다
    if (item.salePriceJpy > 0) {
      const prod = await prisma.product.findUnique({
        where: { id: item.productId },
        select: { salePriceJpy: true },
      })
      if (prod && prod.salePriceJpy <= 0) {
        await prisma.product.update({
          where: { id: item.productId },
          data: { salePriceJpy: item.salePriceJpy },
        })
      }
    }
    // 2) 카탈로그에서 온 항목: 매칭(공급사상품) 반영 + 카탈로그 가격이 비어있으면 채움
    //    공급사를 변경해 주문했어도 그 변경이 그대로 카탈로그 매칭에 반영된다.
    if (item.catalogId) {
      const cat = await prisma.aricoCatalog.findUnique({
        where: { id: item.catalogId },
        select: { priceJpy: true },
      })
      const data: { supplierProductId: number; priceJpy?: number } = { supplierProductId: item.productId }
      if (cat && cat.priceJpy <= 0 && item.salePriceJpy > 0) data.priceJpy = item.salePriceJpy
      await prisma.aricoCatalog.update({ where: { id: item.catalogId }, data })
        .catch(() => { /* 삭제된 카탈로그 등은 무시 */ })
    }
  }

  return NextResponse.json(order, { status: 201 })
}
