import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { maxCustomerSeq } from '@/lib/seq'
import { calcCostJpy } from '@/lib/utils'
import { resolveOptionLabels, extractOptionCode } from '@/lib/smaregi-option'
import {
  getAllOrdersDetailed, fmtOrderDate,
  memberPostal, memberAddress,
  makeshopConfigured, MakeshopError,
  type MakeshopMemberDetail,
} from '@/lib/makeshop'

export const maxDuration = 60   // Pro면 60초까지 (대량 수신 대비)

// 수신 제외 품목 — レンタルリム(림 렌탈 구독)은 유통 대상 아님(2026-07-15 결정, 앞으로도 미처리)
const EXCLUDE_ITEM = /レンタルリム/

// 입금상태 매핑(2026-07-15 확정, 지안 확인):
//  0000=代引き입금완료 · 0001=현금입금완료 · 0002=입금완료 · 0004=仮売上(고객결제완료) · 1002=포인트/¥0(미수금 없음) → 입금완료
//  0003=취소(배송상태에서 cancelled 처리) · 그 외 → 미입금
const PAID_CODES = new Set(['0000', '0001', '0002', '0004', '1002'])
function mapPayment(code: string): 'paid' | 'unpaid' {
  return PAID_CODES.has(code) ? 'paid' : 'unpaid'
}
export { PAID_CODES }

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
async function buildPreview(days: number, win?: { start: string; end: string }) {
  const now = new Date()
  // win(명시 구간)이 있으면 그걸 쓰고, 없으면 최근 days일. 종료일 +1일 버퍼(UTC-JST 시차 당일 누락 방지).
  const start = win?.start ?? fmtOrderDate(new Date(now.getTime() - days * 86400000))
  const end = win?.end ?? fmtOrderDate(new Date(now.getTime() + 86400000))
  const orders = await getAllOrdersDetailed(start, end)

  // 카탈로그: productCode → {supplierProductId, name}
  const cats = await prisma.aricoCatalog.findMany({ select: { productCode: true, name: true, supplierProductId: true } })
  const catMap = new Map(cats.map(c => [c.productCode, c]))
  // 매칭된 공급사 상품 로드 (원가 계산용)
  const supIds = [...new Set(cats.map(c => c.supplierProductId).filter((v): v is number => v != null))]
  const products = await prisma.product.findMany({ where: { id: { in: supIds } }, include: { supplier: true } })
  const prodMap = new Map(products.map(p => [p.id, p]))
  const rates = await prisma.exchangeRate.findMany()
  // ⚠️ MakeShop 회원 전수조회(getAllMembersDetailed, 수천명)는 대량 수신 타임아웃의 주범 → 하지 않는다.
  // 기존 거래처는 이름 사용, 새 회원은 memberId로 생성 후 [MakeShop 회원] 동기화로 이름·연락처 보강.
  const orderMemberIds = [...new Set(orders.map(o => o.memberId).filter(Boolean))]
  const knownCusts = await prisma.customer.findMany({ where: { externalMemberId: { in: orderMemberIds } }, select: { externalMemberId: true, name: true } })
  const custNameByMember = new Map(knownCusts.map(c => [c.externalMemberId, c.name]))
  const memberMap = new Map<string, MakeshopMemberDetail>()   // 항상 비움(전수조회 안 함)
  // 이미 수신한 주문
  const imported = new Set((await prisma.order.findMany({ where: { externalOrderNo: { not: '' } }, select: { externalOrderNo: true } })).map(o => o.externalOrderNo))

  const rows: PreviewRow[] = orders.map(o => {
    // レンタルリム(림 렌탈 구독)은 유통 대상 아님 — 수신에서 제외(카탈로그·상품·주문 모두)
    const baskets = (o.deliveryInfos || []).flatMap(d => d.basketInfos || [])
      .filter(b => !EXCLUDE_ITEM.test(b.productName || ''))
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
    // 결제코드 0003 = 취소 → 배송상태와 무관하게 주문상태를 cancelled로 (지안 확정 2026-07-15)
    const orderStatus = o.paymentStatusCode === '0003' ? 'cancelled' : del.orderStatus
    return {
      externalOrderNo: o.systemOrderNumber, displayOrderNumber: o.displayOrderNumber,
      orderDate: o.orderDate, memberId: o.memberId, customerName: memberMap.get(o.memberId)?.name || custNameByMember.get(o.memberId) || o.memberId,
      sumPrice: Number(o.sumPrice) || 0, shipping, itemsSubtotal, payment: mapPayment(o.paymentStatusCode),
      orderStatus, trackingNo: del.trackingNo, shipDate: del.shipDate ? del.shipDate.toISOString() : null,
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
    // 미매칭 품목이 있어도 가져온다(ETC 상품 생성). 가져올 수 있음 = 중복 아니고 품목 남은 것(레タンルリム만인 주문 제외).
    const importable = rows.filter(r => !r.dup && r.items.length > 0).length
    // 옵션 진단: variationCustomCode가 오는 품목 수 + 샘플(어느 필드에 옵션이 오는지 확인용)
    const allItems = rows.flatMap(r => r.items)
    const withVarCode = allItems.filter(i => i.variationCustomCode).length
    const optionSamples = allItems.filter(i => i.variationCustomCode || i.productName).slice(0, 8)
      .map(i => ({ productCode: i.productCode, variationCustomCode: i.variationCustomCode, productName: i.productName }))
    return NextResponse.json({
      ok: true, range: { start, end },
      summary: { total: rows.length, dup: rows.filter(r => r.dup).length, importable, hasUnmatched: rows.filter(r => !r.dup && r.items.length > 0 && !r.allMatched).length, items: allItems.length, withVariationCode: withVarCode },
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

// 실제 수신 로직 (POST·cron 공용). 결과 객체 반환.
export async function runImport(days: number, win?: { start: string; end: string }): Promise<Record<string, unknown>> {
  if (!makeshopConfigured()) return { ok: false, error: 'not_configured' }
  const startedAt = new Date().toISOString()
  try {
    await writeStatus({ state: 'running', days, startedAt, finishedAt: null, created: 0, dup: 0, partial: 0 })
    const { rows, catMap, prodMap, rates, memberMap } = await buildPreview(days, win)
    const targets = rows.filter(r => !r.dup && r.items.length > 0)   // 중복 아닌 전부(미매칭 포함). 품목 0(=レンタルリム만)은 제외
    // 옵션코드(variationCustomCode) → 사람이 읽는 옵션 라벨(스마레지) 사전 해석
    const optLabelMap = await resolveOptionLabels(targets.flatMap(r => r.items.map(i => i.option)))

    // 거래처 코드 러닝 카운터
    let custSeq = await maxCustomerSeq()
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
    // 주문번호 시퀀스: 한 번만 조회(주문마다 findFirst 왕복 제거 = 타임아웃 완화)
    const lastOrd = await prisma.order.findFirst({ orderBy: { id: 'desc' }, select: { orderNo: true } })
    let orderSeq = lastOrd ? (parseInt(lastOrd.orderNo.split('-').pop() || '0', 10) || 0) : 0
    type OrderData = NonNullable<Parameters<typeof prisma.order.create>[0]>['data']
    const orderCreates: OrderData[] = []
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
      const itemsData: { productId: number; quantity: number; salePriceJpy: number; costPriceJpy: number; optionMemo: string; optionLabel: string; procureStatus: string }[] = []
      for (const it of r.items) {
        const prod = await resolveProduct(it.productCode, it.productName, it.price)
        if (!it.matched && !etcSeen.has(it.productCode)) { etcSeen.add(it.productCode); etcCreated++ }
        const costJpy = Math.round(calcCostJpy(prod, rates))
        const optionLabel = optLabelMap.get(extractOptionCode(it.option) || '') || ''
        itemsData.push({ productId: prod.id, quantity: it.amount, salePriceJpy: Math.round(it.price), costPriceJpy: costJpy, optionMemo: it.option, optionLabel, procureStatus })
      }
      const subtotal = itemsData.reduce((s, it) => s + it.salePriceJpy * it.quantity, 0)
      const totalCost = itemsData.reduce((s, it) => s + it.costPriceJpy * it.quantity, 0)
      const paid = r.payment === 'paid'
      const orderDate = new Date(r.orderDate)
      const dateStr = fmtOrderDate(orderDate).slice(0, 8)
      const shipDate = r.shipDate ? new Date(r.shipDate) : null

      orderSeq += 1
      orderCreates.push({
        orderNo: `ORD-${dateStr}-${String(orderSeq).padStart(4, '0')}`,
        customerId: customerId!, externalOrderNo: r.externalOrderNo, orderDate,
        paymentStatus: paid ? 'paid' : 'unpaid', paidAmountJpy: paid ? subtotal : 0,
        paymentDate: paid ? orderDate : null,
        // 배송상태 반영: 배송완료 시 발송일·송장·완료일 세팅
        status: r.orderStatus,
        ...(r.trackingNo ? { trackingNo: r.trackingNo } : {}),
        ...(shipDate ? { shippingDate: shipDate } : {}),
        ...(r.orderStatus === 'delivered' && shipDate ? { deliveryDate: shipDate, completedAt: shipDate } : {}),
        subtotalJpy: subtotal, totalAmountJpy: subtotal, totalCostJpy: totalCost, memo: '',
        items: { create: itemsData },
      })
    }

    // 주문 생성 — 번호 미리 유니크 배정 후 8개씩 병렬(대량 시 순차 왕복 타임아웃 방지)
    const CONC = 8
    for (let i = 0; i < orderCreates.length; i += CONC) {
      const res = await Promise.allSettled(orderCreates.slice(i, i + CONC).map(data => prisma.order.create({ data })))
      for (const x of res) {
        if (x.status === 'fulfilled') created++
        else console.error('order create failed:', (x.reason as { message?: string })?.message)
      }
      if (i % 80 === 0) await writeStatus({ state: 'running', days, startedAt, finishedAt: null, created, dup: 0, partial: 0 }).catch(() => {})
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
    return { ok: true, created, skipped, dup: skipped, etcCreated, custCreated, custUpdated, partial, optionFilled }
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    await writeStatus({ state: 'error', days, startedAt, finishedAt: new Date().toISOString(), created: 0, dup: 0, partial: 0, error: String(err.error) }).catch(() => {})
    return { ok: false, ...err }
  }
}

// POST — 수동 수신(로그인 필요).
export async function POST(req: Request) {
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 90))
  const result = await runImport(days)
  const status = result.ok ? 200 : result.error === 'not_configured' ? 503 : 502
  return NextResponse.json(result, { status })
}
