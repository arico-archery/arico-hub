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

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { status, expectedDate, receivedDate, memo, receiveItems, confirmItems, pay } = body
  const poId = Number(id)

  // ── 재고확인(제조사 청구서 수령): confirmItems = [{ itemId, confirmedQty }] ──
  // + supplierInvoiceNo, confirmedForeign, confirmedCurrency, confirmedTotalJpy
  if (confirmItems && Array.isArray(confirmItems)) {
    for (const ci of confirmItems as { itemId: number; confirmedQty: number }[]) {
      const item = await prisma.purchaseOrderItem.findUnique({ where: { id: ci.itemId } })
      if (!item) continue
      const cq = Math.max(0, Math.min(ci.confirmedQty, item.quantity))
      await prisma.purchaseOrderItem.update({ where: { id: ci.itemId }, data: { confirmedQty: cq } })

      // 확정수량 < 발주수량: 잔여분(품절 또는 부분재고)을 백오더로 되돌림(재발주 대기)
      // 연결된 고객 주문품목에 확정수량(cq)을 순서대로 할당하고, 초과분은 분리해 needed 처리
      if (cq < item.quantity) {
        const linked = await prisma.orderItem.findMany({
          where: { purchaseOrderId: poId, productId: item.productId },
          orderBy: { id: 'asc' },
        })
        let keep = cq  // 이 발주에 남길 수량
        for (const oi of linked) {
          if (keep >= oi.quantity) {
            keep -= oi.quantity          // 주문품목 전체를 발주에 유지
          } else if (keep > 0) {
            // 분할: keep 만큼만 발주 유지, 나머지는 신규 백오더 행으로 분리
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
            // 남길 수량 소진: 주문품목 전체를 백오더로
            await prisma.orderItem.update({
              where: { id: oi.id },
              data: { purchaseOrderId: null, procureStatus: 'needed' },
            })
          }
        }
      }
    }

    const confirmData: Record<string, unknown> = {
      status: 'confirmed',
      confirmedDate: new Date(),
    }
    if (body.supplierInvoiceNo !== undefined) confirmData.supplierInvoiceNo = String(body.supplierInvoiceNo)
    if (body.confirmedCurrency !== undefined) confirmData.confirmedCurrency = String(body.confirmedCurrency)
    if (body.confirmedForeign !== undefined) confirmData.confirmedForeign = Number(body.confirmedForeign) || 0
    if (body.confirmedTotalJpy !== undefined) confirmData.confirmedTotalJpy = Number(body.confirmedTotalJpy) || 0
    await prisma.purchaseOrder.update({ where: { id: poId }, data: confirmData })

    // 확정된 품목의 고객 주문 품목 → '발주완료(ordered)'로 (아직 needed면)
    await prisma.orderItem.updateMany({
      where: { purchaseOrderId: poId, procureStatus: 'needed' },
      data: { procureStatus: 'ordered' },
    })
  }

  // ── 매입 지급(제조사 입금): pay = { paidAmountJpy, paidDate } ──
  if (pay) {
    await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        paymentStatus: 'paid',
        paidAmountJpy: Number(pay.paidAmountJpy) || 0,
        paidDate: pay.paidDate ? new Date(pay.paidDate) : new Date(),
        status: 'paid',
      },
    })
  }

  // 입고 처리: receiveItems = [{ itemId, receivedQty }]
  if (receiveItems && Array.isArray(receiveItems)) {
    for (const ri of receiveItems as { itemId: number; receivedQty: number }[]) {
      const item = await prisma.purchaseOrderItem.findUnique({ where: { id: ri.itemId } })
      if (!item) continue
      // 확정수량이 있으면 그 수량까지만 입고 가능
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

    // 입고 상태 자동 판정 (확정수량 기준; 품절 품목은 목표 0이라 자동 충족)
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
