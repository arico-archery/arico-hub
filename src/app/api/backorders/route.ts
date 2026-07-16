import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extractOptionCode } from '@/lib/smaregi-option'

/**
 * GET /api/backorders
 * procureStatus 필터: needed | ordered | received | all (기본: needed,ordered)
 * supplier 필터: supplierCode
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const statusParam = searchParams.get('status') ?? 'needed,ordered'
  const supplier    = searchParams.get('supplier') ?? ''
  const from        = searchParams.get('from') ?? ''   // 주문일 시작(ISO) — 기간 스코프
  const to          = searchParams.get('to') ?? ''

  const statusList = statusParam === 'all'
    ? ['needed', 'ordered', 'received']
    : statusParam.split(',').map(s => s.trim())

  const orderDateFilter: { gte?: Date; lte?: Date } = {}
  if (from && !isNaN(Date.parse(from))) orderDateFilter.gte = new Date(from)
  if (to && !isNaN(Date.parse(to))) orderDateFilter.lte = new Date(to)

  const items = await prisma.orderItem.findMany({
    where: {
      procureStatus: { in: statusList },
      // 취소된 주문 제외 + 기간 필터
      order: { status: { not: 'cancelled' }, ...(Object.keys(orderDateFilter).length ? { orderDate: orderDateFilter } : {}) },
      // 공급사 필터
      ...(supplier ? { product: { supplierCode: supplier } } : {}),
    },
    include: {
      order: {
        include: { customer: true },
      },
      product: {
        include: { supplier: true },
      },
      purchaseOrder: {
        select: { id: true, poNo: true, status: true, expectedDate: true },
      },
    },
    orderBy: [
      { order: { orderDate: 'asc' } },  // 오래된 주문 먼저
      { product: { supplierCode: 'asc' } },
    ],
  })

  // 스마레지 재고 부착 — 옵션코드(=스마레지 productCode)로 조회. 재고 없는 것만 실제 발주 대상.
  const codes = [...new Set(items.map(i => extractOptionCode(i.optionMemo)).filter((c): c is string => !!c))]
  const smRows = codes.length
    ? await prisma.smaregiProduct.findMany({ where: { productCode: { in: codes } }, select: { productCode: true, stock: true, stockTokyo: true, stockAichi: true } })
    : []
  const smMap = new Map(smRows.map(s => [s.productCode, s]))
  const enriched = items.map(i => {
    const c = extractOptionCode(i.optionMemo)
    const sm = c ? smMap.get(c) : null
    return { ...i, smaregiStock: sm ? { total: sm.stock, tokyo: sm.stockTokyo, aichi: sm.stockAichi } : null }
  })

  return NextResponse.json(enriched)
}
