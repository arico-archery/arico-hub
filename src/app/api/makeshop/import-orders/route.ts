import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createWithSeqRetry } from '@/lib/seq'
import { calcCostJpy } from '@/lib/utils'
import {
  searchOrdersDetailed, getAllMembers, fmtOrderDate,
  makeshopConfigured, MakeshopError,
} from '@/lib/makeshop'

// 입금상태 매핑(임시): 0002=입금완료, 그 외=미입금. 실제 코드 뜻 확인되면 보정.
function mapPayment(code: string): 'paid' | 'unpaid' {
  return code === '0002' ? 'paid' : 'unpaid'
}

type PreviewItem = { productCode: string; productName: string; amount: number; price: number; matched: boolean; supplierCode: string | null; catalogName: string | null }
type PreviewRow = {
  externalOrderNo: string; displayOrderNumber: string; orderDate: string; memberId: string; customerName: string
  sumPrice: number; shipping: number; itemsSubtotal: number; payment: 'paid' | 'unpaid'
  dup: boolean; allMatched: boolean; items: PreviewItem[]
}

// 주문 수신 + 매칭. days 만큼 과거 주문을 가져와 productCode로 매칭한다.
async function buildPreview(days: number) {
  const now = new Date()
  const start = fmtOrderDate(new Date(now.getTime() - days * 86400000))
  const end = fmtOrderDate(now)
  const orders = await searchOrdersDetailed(start, end, 1, 200)

  // 카탈로그: productCode → {supplierProductId, name}
  const cats = await prisma.aricoCatalog.findMany({ select: { productCode: true, name: true, supplierProductId: true } })
  const catMap = new Map(cats.map(c => [c.productCode, c]))
  // 매칭된 공급사 상품 로드 (원가 계산용)
  const supIds = [...new Set(cats.map(c => c.supplierProductId).filter((v): v is number => v != null))]
  const products = await prisma.product.findMany({ where: { id: { in: supIds } }, include: { supplier: true } })
  const prodMap = new Map(products.map(p => [p.id, p]))
  const rates = await prisma.exchangeRate.findMany()
  // 회원 memberId → name
  const members = await getAllMembers()
  const memberMap = new Map(members.map(m => [m.memberId, m.name]))
  // 이미 수신한 주문
  const imported = new Set((await prisma.order.findMany({ where: { externalOrderNo: { not: '' } }, select: { externalOrderNo: true } })).map(o => o.externalOrderNo))

  const rows: PreviewRow[] = orders.map(o => {
    const baskets = (o.deliveryInfos || []).flatMap(d => d.basketInfos || [])
    const shipping = (o.deliveryInfos || []).reduce((s, d) => s + (Number(d.shippingCharge) || 0), 0)
    const items: PreviewItem[] = baskets.map(b => {
      const cat = catMap.get(b.productCode)
      const prod = cat?.supplierProductId != null ? prodMap.get(cat.supplierProductId) : undefined
      return {
        productCode: b.productCode, productName: b.productName, amount: Number(b.amount) || 0, price: Number(b.price) || 0,
        matched: !!prod, supplierCode: prod?.supplierCode ?? null, catalogName: cat?.name ?? null,
      }
    })
    const itemsSubtotal = items.reduce((s, it) => s + it.price * it.amount, 0)
    return {
      externalOrderNo: o.systemOrderNumber, displayOrderNumber: o.displayOrderNumber,
      orderDate: o.orderDate, memberId: o.memberId, customerName: memberMap.get(o.memberId) || o.memberId,
      sumPrice: Number(o.sumPrice) || 0, shipping, itemsSubtotal, payment: mapPayment(o.paymentStatusCode),
      dup: imported.has(o.systemOrderNumber), allMatched: items.length > 0 && items.every(i => i.matched), items,
    }
  })
  return { start, end, rows, catMap, prodMap, rates }
}

// GET — 미리보기(검수). 쓰기 없음.
export async function GET(req: Request) {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 90))
  try {
    const { start, end, rows } = await buildPreview(days)
    const importable = rows.filter(r => !r.dup && r.allMatched).length
    return NextResponse.json({
      ok: true, range: { start, end },
      summary: { total: rows.length, dup: rows.filter(r => r.dup).length, importable, hasUnmatched: rows.filter(r => !r.dup && !r.allMatched).length },
      rows,
    })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}

// POST — 실제 생성. importable(미중복 & 전품목 매칭)만 생성.
export async function POST(req: Request) {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 90))
  try {
    const { rows, catMap, prodMap, rates } = await buildPreview(days)
    const targets = rows.filter(r => !r.dup && r.allMatched)

    // 거래처 코드 러닝 카운터
    const lastCust = await prisma.customer.findFirst({ where: { code: { startsWith: 'C' } }, orderBy: { code: 'desc' }, select: { code: true } })
    let custSeq = lastCust ? (parseInt(lastCust.code.slice(1), 10) || 0) : 0
    // externalMemberId → customerId 캐시
    const custByMember = new Map((await prisma.customer.findMany({ where: { externalMemberId: { not: '' } }, select: { id: true, externalMemberId: true } })).map(c => [c.externalMemberId, c.id]))

    let created = 0, skipped = 0
    for (const r of targets) {
      // 거래처 확보
      let customerId = custByMember.get(r.memberId)
      if (!customerId) {
        custSeq += 1
        const c = await prisma.customer.create({ data: { code: `C${String(custSeq).padStart(3, '0')}`, name: r.customerName || r.memberId, externalMemberId: r.memberId } })
        customerId = c.id
        custByMember.set(r.memberId, customerId)
      }
      // 품목 데이터
      const itemsData = r.items.map(it => {
        const cat = catMap.get(it.productCode)!
        const prod = prodMap.get(cat.supplierProductId!)!
        const costJpy = Math.round(calcCostJpy(prod, rates))
        return { productId: prod.id, quantity: it.amount, salePriceJpy: Math.round(it.price), costPriceJpy: costJpy, optionMemo: '' }
      })
      const subtotal = itemsData.reduce((s, it) => s + it.salePriceJpy * it.quantity, 0)
      const totalCost = itemsData.reduce((s, it) => s + it.costPriceJpy * it.quantity, 0)
      const paid = r.payment === 'paid'
      const orderDate = new Date(r.orderDate)
      const dateStr = fmtOrderDate(orderDate).slice(0, 8)
      const memo = `[MakeShop ${r.displayOrderNumber}] 결제총액 ¥${r.sumPrice.toLocaleString()}${r.shipping ? ` (배송비 ¥${r.shipping.toLocaleString()})` : ''}`

      await createWithSeqRetry(
        async (attempt) => {
          const last = await prisma.order.findFirst({ orderBy: { id: 'desc' }, select: { orderNo: true } })
          const lastSeq = last ? (parseInt(last.orderNo.split('-').pop() || '0', 10) || 0) : 0
          return `ORD-${dateStr}-${String(lastSeq + 1 + attempt).padStart(4, '0')}`
        },
        (orderNo) => prisma.order.create({
          data: {
            orderNo, customerId: customerId!, externalOrderNo: r.externalOrderNo, orderDate,
            paymentStatus: paid ? 'paid' : 'unpaid', paidAmountJpy: paid ? subtotal : 0,
            paymentDate: paid ? orderDate : null,
            subtotalJpy: subtotal, totalAmountJpy: subtotal, totalCostJpy: totalCost, memo,
            items: { create: itemsData },
          },
        }),
      )
      created++
    }
    skipped = rows.length - targets.length
    return NextResponse.json({ ok: true, created, skipped, dup: rows.filter(r => r.dup).length, unmatched: rows.filter(r => !r.dup && !r.allMatched).length })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
