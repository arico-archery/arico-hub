import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createWithSeqRetry } from '@/lib/seq'
import { calcCostJpy } from '@/lib/utils'
import {
  getAllOrdersDetailed, getAllMembersDetailed, fmtOrderDate,
  memberPostal, memberAddress,
  makeshopConfigured, MakeshopError,
} from '@/lib/makeshop'

// 입금상태 매핑(임시): 0002=입금완료, 그 외=미입금. 실제 코드 뜻 확인되면 보정.
function mapPayment(code: string): 'paid' | 'unpaid' {
  return code === '0002' ? 'paid' : 'unpaid'
}

// YYYYMMDDHHmmss → Date
function parseMsDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{14}$/.test(s)) return null
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14)))
}
// 배송상태 매핑: deliveryStatus Y = 발송/배송완료(송장·발송일), キャンセル/返金 = 취소, 그 외 = 접수.
type DeliveryMap = { orderStatus: 'pending' | 'delivered' | 'cancelled'; trackingNo: string; shipDate: Date | null }
function mapDelivery(o: { deliveryInfos: { deliveryStatus: string; slipNumber: string; deliveryDate: string }[] }): DeliveryMap {
  const d = (o.deliveryInfos || [])[0]
  const status = d?.deliveryStatus || ''
  const slip = d?.slipNumber || ''
  if (status === 'Y') return { orderStatus: 'delivered', trackingNo: slip, shipDate: parseMsDate(d?.deliveryDate) }
  if (/キャンセル|返金|取消|キャンセ/.test(slip)) return { orderStatus: 'cancelled', trackingNo: '', shipDate: null }
  return { orderStatus: 'pending', trackingNo: '', shipDate: null }
}

type PreviewItem = { productCode: string; productName: string; amount: number; price: number; matched: boolean; supplierCode: string | null; catalogName: string | null }
type PreviewRow = {
  externalOrderNo: string; displayOrderNumber: string; orderDate: string; memberId: string; customerName: string
  sumPrice: number; shipping: number; itemsSubtotal: number; payment: 'paid' | 'unpaid'
  orderStatus: 'pending' | 'delivered' | 'cancelled'; trackingNo: string; shipDate: string | null
  dup: boolean; allMatched: boolean; items: PreviewItem[]
}

// 주문 수신 + 매칭. days 만큼 과거 주문을 가져와 productCode로 매칭한다.
async function buildPreview(days: number) {
  const now = new Date()
  const start = fmtOrderDate(new Date(now.getTime() - days * 86400000))
  const end = fmtOrderDate(now)
  const orders = await getAllOrdersDetailed(start, end)

  // 카탈로그: productCode → {supplierProductId, name}
  const cats = await prisma.aricoCatalog.findMany({ select: { productCode: true, name: true, supplierProductId: true } })
  const catMap = new Map(cats.map(c => [c.productCode, c]))
  // 매칭된 공급사 상품 로드 (원가 계산용)
  const supIds = [...new Set(cats.map(c => c.supplierProductId).filter((v): v is number => v != null))]
  const products = await prisma.product.findMany({ where: { id: { in: supIds } }, include: { supplier: true } })
  const prodMap = new Map(products.map(p => [p.id, p]))
  const rates = await prisma.exchangeRate.findMany()
  // 회원 memberId → 상세(이름·이메일·전화·주소)
  const members = await getAllMembersDetailed()
  const memberMap = new Map(members.map(m => [m.memberId, m]))
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
    const del = mapDelivery(o)
    return {
      externalOrderNo: o.systemOrderNumber, displayOrderNumber: o.displayOrderNumber,
      orderDate: o.orderDate, memberId: o.memberId, customerName: memberMap.get(o.memberId)?.name || o.memberId,
      sumPrice: Number(o.sumPrice) || 0, shipping, itemsSubtotal, payment: mapPayment(o.paymentStatusCode),
      orderStatus: del.orderStatus, trackingNo: del.trackingNo, shipDate: del.shipDate ? del.shipDate.toISOString() : null,
      dup: imported.has(o.systemOrderNumber), allMatched: items.length > 0 && items.every(i => i.matched), items,
    }
  })
  return { start, end, rows, catMap, prodMap, rates, memberMap }
}

// GET — 미리보기(검수). 쓰기 없음.
export async function GET(req: Request) {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 90))
  try {
    const { start, end, rows } = await buildPreview(days)
    // 미매칭 품목이 있어도 가져온다(ETC 상품 생성). 가져올 수 있음 = 중복 아닌 전부.
    const importable = rows.filter(r => !r.dup).length
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
    const { rows, catMap, prodMap, rates, memberMap } = await buildPreview(days)
    const targets = rows.filter(r => !r.dup)   // 중복 아닌 전부 (미매칭 품목 포함)

    // 거래처 코드 러닝 카운터
    const lastCust = await prisma.customer.findFirst({ where: { code: { startsWith: 'C' } }, orderBy: { code: 'desc' }, select: { code: true } })
    let custSeq = lastCust ? (parseInt(lastCust.code.slice(1), 10) || 0) : 0
    // externalMemberId → customerId 캐시
    const custByMember = new Map((await prisma.customer.findMany({ where: { externalMemberId: { not: '' } }, select: { id: true, externalMemberId: true } })).map(c => [c.externalMemberId, c.id]))

    // 미매칭 품목 → ETC 상품 확보(productCode별 생성/재사용). 주문관리에서 수정 가능.
    type ProdLite = { id: number; costPrice: number; brand: string; supplierCode: string; name: string; supplier: { currency: string; taxRate: number; discount: number } }
    const etcCache = new Map<string, ProdLite>()
    const resolveProduct = async (productCode: string, productName: string, price: number): Promise<ProdLite> => {
      const cat = catMap.get(productCode)
      if (cat?.supplierProductId != null) {
        const prod = prodMap.get(cat.supplierProductId)
        if (prod) return prod as unknown as ProdLite
      }
      if (etcCache.has(productCode)) return etcCache.get(productCode)!
      let prod = await prisma.product.findUnique({ where: { supplierCode_productCode: { supplierCode: 'ETC', productCode } }, include: { supplier: true } })
      if (!prod) {
        prod = await prisma.product.create({
          data: { supplierCode: 'ETC', productCode, name: productName || productCode, brand: '', category: '', costPrice: 0, salePriceJpy: Math.round(price), unit: '1' },
          include: { supplier: true },
        })
      }
      const lite = prod as unknown as ProdLite
      etcCache.set(productCode, lite)
      return lite
    }

    let created = 0, skipped = 0, etcCreated = 0, custCreated = 0, custUpdated = 0
    const etcSeen = new Set<string>()
    const custSynced = new Set<string>()   // 이번 실행에서 갱신한 회원(중복 update 방지)
    for (const r of targets) {
      // 거래처 확보 (전부 연동, 회원 연락처·주소까지)
      const m = memberMap.get(r.memberId)
      let customerId = custByMember.get(r.memberId)
      if (!customerId) {
        custSeq += 1
        const c = await prisma.customer.create({ data: {
          code: `C${String(custSeq).padStart(3, '0')}`,
          name: r.customerName || r.memberId, externalMemberId: r.memberId,
          email: m?.email || '', phone: m?.tel || '',
          address: memberAddress(m), postalCode: memberPostal(m),
        } })
        customerId = c.id
        custByMember.set(r.memberId, customerId)
        custCreated++
      } else if (m && !custSynced.has(r.memberId)) {
        // 기존 거래처 갱신 — 회원에 값 있는 필드만 덮어씀
        const data: Record<string, string> = {}
        if (m.name) data.name = m.name
        if (m.email) data.email = m.email
        if (m.tel) data.phone = m.tel
        const addr = memberAddress(m); if (addr) data.address = addr
        const pc = memberPostal(m); if (pc) data.postalCode = pc
        if (Object.keys(data).length) { await prisma.customer.update({ where: { id: customerId }, data }); custUpdated++ }
        custSynced.add(r.memberId)
      }
      // 품목 데이터 (미매칭은 ETC 상품으로).
      // 배송완료·취소 주문은 이미 발주·입고 끝난 것 → 조달상태 received(백오더 제외).
      const procureStatus = (r.orderStatus === 'delivered' || r.orderStatus === 'cancelled') ? 'received' : 'needed'
      const itemsData: { productId: number; quantity: number; salePriceJpy: number; costPriceJpy: number; optionMemo: string; procureStatus: string }[] = []
      for (const it of r.items) {
        const prod = await resolveProduct(it.productCode, it.productName, it.price)
        if (!it.matched && !etcSeen.has(it.productCode)) { etcSeen.add(it.productCode); etcCreated++ }
        const costJpy = Math.round(calcCostJpy(prod, rates))
        itemsData.push({ productId: prod.id, quantity: it.amount, salePriceJpy: Math.round(it.price), costPriceJpy: costJpy, optionMemo: '', procureStatus })
      }
      const subtotal = itemsData.reduce((s, it) => s + it.salePriceJpy * it.quantity, 0)
      const totalCost = itemsData.reduce((s, it) => s + it.costPriceJpy * it.quantity, 0)
      const paid = r.payment === 'paid'
      const orderDate = new Date(r.orderDate)
      const dateStr = fmtOrderDate(orderDate).slice(0, 8)
      const shipDate = r.shipDate ? new Date(r.shipDate) : null
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
            // 배송상태 반영: 배송완료 시 발송일·송장·완료일 세팅
            status: r.orderStatus,
            ...(r.trackingNo ? { trackingNo: r.trackingNo } : {}),
            ...(shipDate ? { shippingDate: shipDate } : {}),
            ...(r.orderStatus === 'delivered' && shipDate ? { deliveryDate: shipDate, completedAt: shipDate } : {}),
            subtotalJpy: subtotal, totalAmountJpy: subtotal, totalCostJpy: totalCost, memo,
            items: { create: itemsData },
          },
        }),
      )
      created++
    }
    skipped = rows.filter(r => r.dup).length
    return NextResponse.json({ ok: true, created, skipped, dup: skipped, etcCreated, custCreated, custUpdated, partial: rows.filter(r => !r.dup && !r.allMatched).length })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
