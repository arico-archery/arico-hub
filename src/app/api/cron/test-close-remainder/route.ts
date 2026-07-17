import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { PATCH as poPatch } from '@/app/api/purchase-orders/[id]/route'

export const maxDuration = 60

// 「나머지 없음」 입고 마감이 부족분을 백오더로 되돌리는지 실제 라우트로 검증(일회성).
// 테스트 데이터를 만들고 → 실행 → 검증 → 반드시 지운다. HMAC 보호.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const token = new URL(req.url).searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const log: string[] = []
  const made: { customerId?: number; orderId?: number; poId?: number; productId?: number } = {}
  try {
    // ── 준비: 테스트용 상품·거래처·주문(5개)·발주(5개)
    const supplier = await prisma.supplier.findFirst({ where: { code: 'ETC' } })
    if (!supplier) return NextResponse.json({ ok: false, error: 'ETC 공급사 없음' })

    const product = await prisma.product.create({
      data: { supplierCode: 'ETC', productCode: `__TEST_${Date.now()}`, name: '__TEST 나머지없음 검증용', costPrice: 100, salePriceJpy: 200 },
    })
    made.productId = product.id
    const customer = await prisma.customer.create({ data: { code: `__T${Date.now()}`, name: '__TEST 고객' } })
    made.customerId = customer.id
    const order = await prisma.order.create({
      data: {
        orderNo: `__TEST-${Date.now()}`, customerId: customer.id, subtotalJpy: 1000, totalAmountJpy: 1000,
        items: { create: [{ productId: product.id, quantity: 5, salePriceJpy: 200, costPriceJpy: 100, procureStatus: 'ordered' }] },
      },
      include: { items: true },
    })
    made.orderId = order.id
    const po = await prisma.purchaseOrder.create({
      data: {
        poNo: `__TESTPO-${Date.now()}`, supplierCode: 'ETC', status: 'ordered', totalCostJpy: 500,
        items: { create: [{ productId: product.id, quantity: 5, unitCostJpy: 100 }] },
      },
      include: { items: true },
    })
    made.poId = po.id
    // 주문품목을 이 발주에 연결
    await prisma.orderItem.update({ where: { id: order.items[0].id }, data: { purchaseOrderId: po.id } })
    log.push(`준비: 주문 5개 / 발주 5개 (PO ${po.poNo})`)

    // ── 실행: 2개만 입고 + 「나머지 없음」
    const res = await poPatch(
      new Request('http://x', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiveItems: [{ itemId: po.items[0].id, receivedQty: 2 }], closeRemainder: true }),
      }),
      { params: Promise.resolve({ id: String(po.id) }) },
    )
    log.push(`실행: 2개 입고 + 나머지없음 체크 → HTTP ${res.status}`)

    // ── 검증
    const poAfter = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, include: { items: true } })
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } })
    const stock = await prisma.stockLevel.findUnique({ where: { productId: product.id } })

    const checks = {
      '발주 상태가 입고완료': poAfter?.status === 'received',
      '확보수량 2로 확정': poAfter?.items[0].confirmedQty === 2,
      '입고수량 2': poAfter?.items[0].receivedQty === 2,
      '재고 2 증가': stock?.quantity === 2,
      '주문품목이 2개로 분리됨': items.length === 2,
      '발주에 남은 건 2개': items.find(i => i.purchaseOrderId === po.id)?.quantity === 2,
      '백오더로 돌아간 건 3개': items.find(i => i.purchaseOrderId === null)?.quantity === 3,
      '백오더 건은 미발주 상태': items.find(i => i.purchaseOrderId === null)?.procureStatus === 'needed',
    }
    const pass = Object.values(checks).every(Boolean)
    return NextResponse.json({ ok: true, pass, checks, log, detail: items.map(i => ({ qty: i.quantity, po: i.purchaseOrderId, st: i.procureStatus })) })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), log }, { status: 500 })
  } finally {
    // ── 뒷정리: 만든 테스트 데이터는 무조건 삭제
    if (made.orderId) await prisma.orderItem.deleteMany({ where: { orderId: made.orderId } }).catch(() => {})
    if (made.poId) await prisma.purchaseOrder.delete({ where: { id: made.poId } }).catch(() => {})
    if (made.orderId) await prisma.order.delete({ where: { id: made.orderId } }).catch(() => {})
    if (made.customerId) await prisma.customer.delete({ where: { id: made.customerId } }).catch(() => {})
    if (made.productId) {
      await prisma.stockLevel.deleteMany({ where: { productId: made.productId } }).catch(() => {})
      await prisma.product.delete({ where: { id: made.productId } }).catch(() => {})
    }
  }
}
