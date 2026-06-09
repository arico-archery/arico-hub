import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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

  // paymentStatus는 쉼표 구분 다중 값 지원 (예: "unpaid,partial")
  const paymentStatusFilter = paymentStatus.includes(',')
    ? { paymentStatus: { in: paymentStatus.split(',').map(s => s.trim()) } }
    : paymentStatus ? { paymentStatus } : {}

  const where = {
    ...(status ? { status } : {}),
    ...paymentStatusFilter,
    ...(customerId ? { customerId: Number(customerId) } : {}),
    // 완료 필터: '1'=completedAt 있음, '0'=completedAt 없음
    ...(completed === '1' ? { completedAt: { not: null } } : {}),
    ...(completed === '0' ? { completedAt: null } : {}),
    ...(q ? {
      OR: [
        { orderNo: { contains: q, mode: 'insensitive' as const } },
        { customer: { name: { contains: q, mode: 'insensitive' as const } } },
        { customer: { company: { contains: q, mode: 'insensitive' as const } } },
        { memo: { contains: q, mode: 'insensitive' as const } },
      ]
    } : {}),
  }

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
  const { customerId, items, memo, dueDate } = body

  // Generate order number
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const count = await prisma.order.count()
  const orderNo = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`

  // Calculate totals
  type OrderItemInput = {
    productId: number; quantity: number; salePriceJpy: number
    costPriceJpy: number; optionMemo?: string; catalogId?: number | null
  }
  let totalAmountJpy = 0
  let totalCostJpy = 0
  const itemsData = (items as OrderItemInput[]).map((item) => {
    totalAmountJpy += item.salePriceJpy * item.quantity
    totalCostJpy += item.costPriceJpy * item.quantity
    return {
      productId: item.productId,
      quantity: item.quantity,
      salePriceJpy: item.salePriceJpy,
      costPriceJpy: item.costPriceJpy,
      optionMemo: item.optionMemo ?? '',
    }
  })

  const order = await prisma.order.create({
    data: {
      orderNo,
      customerId: Number(customerId),
      memo: memo ?? '',
      dueDate: dueDate ? new Date(dueDate) : null,
      totalAmountJpy,
      totalCostJpy,
      items: { create: itemsData },
    },
    include: {
      customer: true,
      items: { include: { product: true } },
    },
  })

  // 주문에서 사람이 확정한 정보를 공급사 상품 / ARICO 카탈로그에 역반영한다.
  // 주문이 쌓일수록 판매가·매칭이 실제 거래 기준으로 점점 정확해진다.
  for (const item of items as OrderItemInput[]) {
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
