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

type PreviewItem = { productCode: string; productName: string; variationCustomCode: string; option: string; amount: number; price: number; matched: boolean; supplierCode: string | null; catalogName: string | null }

// MakeShop basket에서 옵션(색/사이즈 등) 추출. 우선 variationCustomCode, 없으면 빈값.
// (실제 옵션이 어느 필드에 오는지 미리보기의 variationCustomCode/productName로 확인 후 보강)
function basketOption(b: { variationCustomCode?: string }): string {
  return (b.variationCustomCode || '').trim()
}
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
  // 종료일 +1일 버퍼: 서버(UTC)-MakeShop(JST 9h) 시차로 당일 최신 주문이 범위 끝에서 누락되는 것 방지
  const end = fmtOrderDate(new Date(now.getTime() + 86400000))
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
        productCode: b.productCode, productName: b.productName,
        variationCustomCode: b.variationCustomCode || '', option: basketOption(b),
        amount: Number(b.amount) || 0, price: Number(b.price) || 0,
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
    // 옵션 진단: variationCustomCode가 오는 품목 수 + 샘플(어느 필드에 옵션이 오는지 확인용)
    const allItems = rows.flatMap(r => r.items)
    const withVarCode = allItems.filter(i => i.variationCustomCode).length
    const optionSamples = allItems.filter(i => i.variationCustomCode || i.productName).slice(0, 8)
      .map(i => ({ productCode: i.productCode, variationCustomCode: i.variationCustomCode, productName: i.productName }))
    return NextResponse.json({
      ok: true, range: { start, end },
      summary: { total: rows.length, dup: rows.filter(r => r.dup).length, importable, hasUnmatched: rows.filter(r => !r.dup && !r.allMatched).length, items: allItems.length, withVariationCode: withVarCode },
      optionSamples,
      rows,
    })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}

// 수신 진행상태를 Setting에 기록(탭 이동/새로고침에도 유지). 화면이 status API로 조회.
const STATUS_KEY = 'makeshop_import_status'
async function writeStatus(s: Record<string, unknown>) {
  const value = JSON.stringify(s)
  await prisma.setting.upsert({ where: { key: STATUS_KEY }, create: { key: STATUS_KEY, value }, update: { value } })
}

// POST — 실제 생성. importable(미중복 & 전품목 매칭)만 생성.
export async function POST(req: Request) {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 90))
  const startedAt = new Date().toISOString()
  try {
    await writeStatus({ state: 'running', days, startedAt, finishedAt: null, created: 0, dup: 0, partial: 0 })
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
          name: r.customerName || r.memberId, nameKana: m?.nameKana || '', externalMemberId: r.memberId,
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
        if (m.nameKana) data.nameKana = m.nameKana
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
        itemsData.push({ productId: prod.id, quantity: it.amount, salePriceJpy: Math.round(it.price), costPriceJpy: costJpy, optionMemo: it.option, procureStatus })
      }
      const subtotal = itemsData.reduce((s, it) => s + it.salePriceJpy * it.quantity, 0)
      const totalCost = itemsData.reduce((s, it) => s + it.costPriceJpy * it.quantity, 0)
      const paid = r.payment === 'paid'
      const orderDate = new Date(r.orderDate)
      const dateStr = fmtOrderDate(orderDate).slice(0, 8)
      const shipDate = r.shipDate ? new Date(r.shipDate) : null
      const memo = `[MakeShop ${r.displayOrderNumber}] 決済総額 ¥${r.sumPrice.toLocaleString()}${r.shipping ? ` (送料 ¥${r.shipping.toLocaleString()})` : ''}`

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

    // 옵션 백필: 이미 받은 주문(중복)의 품목 optionMemo를 최신 옵션으로 채움.
    // 주문 생성 시 품목은 r.items 순서대로 만들어졌으므로 id 오름차순 = 같은 순서 → 인덱스로 매칭.
    let optionFilled = 0
    const dupRows = rows.filter(r => r.dup && r.items.some(it => it.option))
    if (dupRows.length) {
      const existOrders = await prisma.order.findMany({
        where: { externalOrderNo: { in: dupRows.map(r => r.externalOrderNo) } },
        select: { externalOrderNo: true, items: { select: { id: true, optionMemo: true }, orderBy: { id: 'asc' } } },
      })
      const byExt = new Map(existOrders.map(o => [o.externalOrderNo, o.items]))
      for (const r of dupRows) {
        const items = byExt.get(r.externalOrderNo)
        if (!items) continue
        for (let i = 0; i < r.items.length && i < items.length; i++) {
          const opt = r.items[i].option
          if (opt && items[i].optionMemo !== opt) {
            await prisma.orderItem.update({ where: { id: items[i].id }, data: { optionMemo: opt } })
            optionFilled++
          }
        }
      }
    }

    skipped = rows.filter(r => r.dup).length
    const partial = rows.filter(r => !r.dup && !r.allMatched).length
    await writeStatus({ state: 'done', days, startedAt, finishedAt: new Date().toISOString(), created, dup: skipped, partial, custCreated, custUpdated, optionFilled })
    return NextResponse.json({ ok: true, created, skipped, dup: skipped, etcCreated, custCreated, custUpdated, partial, optionFilled })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    await writeStatus({ state: 'error', days, startedAt, finishedAt: new Date().toISOString(), created: 0, dup: 0, partial: 0, error: String(err.error) }).catch(() => {})
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
