import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { availableByCode, allocate } from '@/lib/stock-allocate'

export const maxDuration = 60

// 투 트랙 재고 충당 로직 검증(일회성). 테스트 데이터를 만들고 → 검증 → 반드시 지운다. HMAC 보호.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const token = new URL(req.url).searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const made: { smId?: number; custId?: number; orderId?: number; prodId?: number } = {}
  // 옵션코드는 10~14자리 숫자여야 인식된다(extractOptionCode). 실제와 겹치지 않을 값.
  const CODE = '9999999999999'
  try {
    // 재고 5개짜리 가짜 스마레지 상품
    const sm = await prisma.smaregiProduct.create({
      data: { productId: '__test9999', productCode: CODE, name: '__TEST 충당검증', stock: 5, stockTokyo: 5, stockAichi: 0 },
    })
    made.smId = sm.id

    const checks: Record<string, unknown> = {}

    // ── 1) 기본: 재고 5, 주문 3 → 전부 재고로
    let avail = await availableByCode()
    checks['가용 초기값 5'] = avail.get(CODE) === 5
    const a1 = allocate(avail, CODE, 3)
    checks['주문3 → 재고3·발주0'] = a1.fromStock === 3 && a1.toOrder === 0
    checks['남은 가용 2'] = avail.get(CODE) === 2

    // ── 2) 같은 수신 안에서 또 주문: 남은 2로 3을 원함 → 2는 재고, 1은 발주 (투 라인)
    const a2 = allocate(avail, CODE, 3)
    checks['주문3(남은2) → 재고2·발주1 (투라인)'] = a2.fromStock === 2 && a2.toOrder === 1
    checks['남은 가용 0'] = avail.get(CODE) === 0

    // ── 3) 재고 소진 후: 전부 발주
    const a3 = allocate(avail, CODE, 4)
    checks['재고0 → 전부 발주'] = a3.fromStock === 0 && a3.toOrder === 4

    // ── 4) 코드 없는 품목(取寄せ 등) → 전부 발주
    const a4 = allocate(avail, '', 2)
    checks['코드없음 → 전부 발주'] = a4.fromStock === 0 && a4.toOrder === 2

    // ── 5) 중복 배정 방지: 미발송 충당분이 가용에서 빠지는가
    const cust = await prisma.customer.create({ data: { code: `__TA${Date.now()}`, name: '__TEST' } })
    made.custId = cust.id
    const prod = await prisma.product.create({
      data: { supplierCode: 'ETC', productCode: `__TAP${Date.now()}`, name: '__TEST 상품', costPrice: 1, salePriceJpy: 2 },
    })
    made.prodId = prod.id
    const ord = await prisma.order.create({
      data: {
        orderNo: `__TA-${Date.now()}`, customerId: cust.id,
        items: { create: [{ productId: prod.id, quantity: 2, salePriceJpy: 2, costPriceJpy: 1, optionMemo: CODE, procureStatus: 'received', stockAllocated: true }] },
      },
    })
    made.orderId = ord.id
    const avail2 = await availableByCode()
    checks['미발송 충당 2건 → 가용 5-2=3'] = avail2.get(CODE) === 3

    // 발송하면 충당분에서 빠져야 한다
    await prisma.order.update({ where: { id: ord.id }, data: { shippingDate: new Date() } })
    const avail3 = await availableByCode()
    checks['발송 후 → 가용 5로 복귀(스마레지가 줄 차례)'] = avail3.get(CODE) === 5

    const pass = Object.values(checks).every(Boolean)
    return NextResponse.json({ ok: true, pass, checks })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  } finally {
    if (made.orderId) { await prisma.orderItem.deleteMany({ where: { orderId: made.orderId } }).catch(() => {}); await prisma.order.delete({ where: { id: made.orderId } }).catch(() => {}) }
    if (made.custId) await prisma.customer.delete({ where: { id: made.custId } }).catch(() => {})
    if (made.prodId) await prisma.product.delete({ where: { id: made.prodId } }).catch(() => {})
    if (made.smId) await prisma.smaregiProduct.delete({ where: { id: made.smId } }).catch(() => {})
  }
}
