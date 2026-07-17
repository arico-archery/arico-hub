import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: Number(id) },
    include: {
      supplier: true,
      items: {
        include: {
          product: { include: { stockLevel: true } },
        },
      },
      // 이 발주와 연결된 고객 주문 품목
      orderItems: {
        include: {
          order:   { include: { customer: true } },
          product: true,
        },
      },
    },
  })
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(po)
}

// 제조사가 발주 수량만큼 못 준 경우, 못 받은 만큼을 백오더(재발주 대기)로 되돌린다.
// 연결된 고객 주문품목에 확보수량(keep)을 오래된 순으로 할당하고, 넘치는 분은
// 별도 행으로 분리해 미발주(needed)로 만든다 → 다음 발주에 다시 잡힌다.
async function returnShortfallToBackorder(poId: number, productId: number, keepQty: number) {
  const linked = await prisma.orderItem.findMany({
    where: { purchaseOrderId: poId, productId },
    orderBy: { id: 'asc' },
  })
  let keep = keepQty
  for (const oi of linked) {
    if (keep >= oi.quantity) {
      keep -= oi.quantity                 // 이 주문품목은 전부 확보됨 → 발주에 유지
    } else if (keep > 0) {
      // 일부만 확보: keep 만큼만 이 발주에 남기고 나머지는 새 행으로 분리
      const leftover = oi.quantity - keep
      await prisma.orderItem.update({ where: { id: oi.id }, data: { quantity: keep } })
      await prisma.orderItem.create({
        data: {
          orderId: oi.orderId, productId: oi.productId, quantity: leftover,
          salePriceJpy: oi.salePriceJpy, costPriceJpy: oi.costPriceJpy,
          procureStatus: 'needed', optionMemo: oi.optionMemo, purchaseOrderId: null,
        },
      })
      keep = 0
    } else {
      // 확보분 소진: 주문품목 통째로 백오더로
      await prisma.orderItem.update({
        where: { id: oi.id },
        data: { purchaseOrderId: null, procureStatus: 'needed' },
      })
    }
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { status, expectedDate, receivedDate, memo, receiveItems, pay } = body
  const poId = Number(id)

  // ── 매입 지급(제조사 입금): pay = { paidAmountJpy, paidDate } ──
  // 제조사 청구서 정보(번호·확정 청구액)도 여기서 함께 기록한다.
  if (pay) {
    const payData: Record<string, unknown> = {
      paymentStatus: 'paid',
      paidAmountJpy: Number(pay.paidAmountJpy) || 0,
      paidDate: pay.paidDate ? new Date(pay.paidDate) : new Date(),
      status: 'paid',
    }
    if (body.supplierInvoiceNo !== undefined) payData.supplierInvoiceNo = String(body.supplierInvoiceNo)
    if (body.confirmedCurrency !== undefined) payData.confirmedCurrency = String(body.confirmedCurrency)
    if (body.confirmedForeign !== undefined) payData.confirmedForeign = Number(body.confirmedForeign) || 0
    if (body.confirmedTotalJpy !== undefined) payData.confirmedTotalJpy = Number(body.confirmedTotalJpy) || 0
    await prisma.purchaseOrder.update({ where: { id: poId }, data: payData })
  }

  // 입고 처리: receiveItems = [{ itemId, receivedQty }]
  //  + closeRemainder=true → 「나머지 없음」: 못 받은 수량은 더 안 온다는 뜻.
  //    확보수량(confirmedQty)에 실입고량을 박아 발주를 종료시키고, 못 받은 만큼은
  //    백오더로 되돌린다. 체크하지 않으면 기존대로 부분입고(2차 입고 대기)로 남는다.
  if (receiveItems && Array.isArray(receiveItems)) {
    for (const ri of receiveItems as { itemId: number; receivedQty: number }[]) {
      const item = await prisma.purchaseOrderItem.findUnique({ where: { id: ri.itemId } })
      if (!item) continue
      // 확보수량이 정해졌으면 그 수량까지만 입고 가능
      const target = item.confirmedQty ?? item.quantity
      const newReceivedQty = Math.min(ri.receivedQty, target)
      await prisma.purchaseOrderItem.update({
        where: { id: ri.itemId },
        data: { receivedQty: newReceivedQty },
      })
      // 재고 증가
      const delta = newReceivedQty - item.receivedQty
      if (delta > 0) {
        await prisma.stockLevel.upsert({
          where: { productId: item.productId },
          create: { productId: item.productId, quantity: delta },
          update: { quantity: { increment: delta } },
        })
      }
    }

    if (body.closeRemainder === true) {
      const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } })
      for (const item of po?.items ?? []) {
        if (item.receivedQty >= item.quantity) continue
        // 실입고량으로 확보수량을 확정 → 이 발주는 더 기다리지 않는다
        await prisma.purchaseOrderItem.update({ where: { id: item.id }, data: { confirmedQty: item.receivedQty } })
        await returnShortfallToBackorder(poId, item.productId, item.receivedQty)
      }
    }

    // 입고 상태 자동 판정 (확보수량 기준; 품절 품목은 목표 0이라 자동 충족)
    const updatedPo = await prisma.purchaseOrder.findUnique({
      where: { id: Number(id) },
      include: { items: true },
    })
    if (updatedPo) {
      const tgt = (i: { confirmedQty: number | null; quantity: number }) => i.confirmedQty ?? i.quantity
      const allReceived = updatedPo.items.every(i => i.receivedQty >= tgt(i))
      const anyReceived = updatedPo.items.some(i => i.receivedQty > 0)
      const autoStatus  = allReceived ? 'received' : anyReceived ? 'partial' : updatedPo.status
      await prisma.purchaseOrder.update({
        where: { id: Number(id) },
        data: {
          status:       autoStatus,
          receivedDate: allReceived ? new Date() : updatedPo.receivedDate,
        },
      })

      // 전체 입고 완료 → 연결된 OrderItem.procureStatus → 'received'
      if (allReceived) {
        await prisma.orderItem.updateMany({
          where: { purchaseOrderId: Number(id) },
          data:  { procureStatus: 'received' },
        })
        // 주문의 모든 품목 received → 주문 상태 confirmed 자동 전환
        const linkedItems = await prisma.orderItem.findMany({
          where:  { purchaseOrderId: Number(id) },
          select: { orderId: true },
        })
        const orderIds = [...new Set(linkedItems.map(i => i.orderId))]
        for (const orderId of orderIds) {
          const allItems = await prisma.orderItem.findMany({ where: { orderId } })
          if (allItems.length > 0 && allItems.every(i => i.procureStatus === 'received')) {
            const order = await prisma.order.findUnique({ where: { id: orderId } })
            if (order && order.status === 'pending') {
              await prisma.order.update({
                where: { id: orderId },
                data:  { status: 'confirmed' },
              })
            }
          }
        }
      }
    }
  }

  // 기타 필드 업데이트
  const updateData: Record<string, unknown> = {}
  if (status !== undefined)       updateData.status       = status
  if (memo !== undefined)         updateData.memo         = memo
  if (expectedDate !== undefined) updateData.expectedDate = expectedDate ? new Date(expectedDate) : null
  if (receivedDate !== undefined) updateData.receivedDate = receivedDate ? new Date(receivedDate) : null

  if (Object.keys(updateData).length > 0) {
    await prisma.purchaseOrder.update({ where: { id: Number(id) }, data: updateData })
  }

  const result = await prisma.purchaseOrder.findUnique({
    where: { id: Number(id) },
    include: {
      supplier: true,
      items: { include: { product: { include: { stockLevel: true } } } },
      orderItems: {
        include: {
          order:   { include: { customer: true } },
          product: true,
        },
      },
    },
  })
  return NextResponse.json(result)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const poId = Number(id)

  // 연결된 주문 품목을 미발주 상태로 되돌리고 발주 연결 해제
  await prisma.orderItem.updateMany({
    where: { purchaseOrderId: poId },
    data:  { purchaseOrderId: null, procureStatus: 'needed' },
  })

  // 발주서 삭제 (PurchaseOrderItem 은 cascade 삭제)
  await prisma.purchaseOrder.delete({ where: { id: poId } })

  return NextResponse.json({ ok: true })
}
