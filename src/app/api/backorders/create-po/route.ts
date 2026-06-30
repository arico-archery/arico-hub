import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createWithSeqRetry, nextPoNo } from '@/lib/seq'

/**
 * POST /api/backorders/create-po
 * body: { orderItemIds: number[], expectedDate?: string, memo?: string }
 *
 * - 선택한 OrderItem들을 공급사별로 그룹화
 * - 공급사별로 PurchaseOrder 생성
 * - PurchaseOrderItem 생성 (같은 상품은 수량 합산)
 * - OrderItem.procureStatus → 'ordered', purchaseOrderId 연결
 */
export async function POST(req: Request) {
  const { orderItemIds, expectedDate, memo } = await req.json() as {
    orderItemIds: number[]
    expectedDate?: string
    memo?: string
  }

  if (!orderItemIds?.length) {
    return NextResponse.json({ error: '선택된 항목이 없습니다' }, { status: 400 })
  }

  // 선택된 OrderItem 조회
  const items = await prisma.orderItem.findMany({
    where: {
      id:            { in: orderItemIds },
      procureStatus: 'needed',    // 미발주 항목만
    },
    include: {
      product: { include: { supplier: true } },
      order:   { include: { customer: true } },
    },
  })

  if (!items.length) {
    return NextResponse.json({ error: '발주 가능한 항목이 없습니다 (이미 발주된 항목은 제외됩니다)' }, { status: 400 })
  }

  // 공급사별 그룹화
  const bySupplier = new Map<string, typeof items>()
  for (const item of items) {
    const sc = item.product.supplierCode
    if (!bySupplier.has(sc)) bySupplier.set(sc, [])
    bySupplier.get(sc)!.push(item)
  }

  const createdPOs: { poNo: string; supplierCode: string; itemCount: number }[] = []

  // 환율 정보
  const rates = await prisma.exchangeRate.findMany()
  const getRate = (currency: string) => rates.find(r => r.currency === currency)?.rateToJpy ?? 1

  // 공급사별 PO 생성
  for (const [supplierCode, groupItems] of bySupplier) {
    const supplier = groupItems[0].product.supplier
    const rate     = getRate(supplier.currency)

    // 같은 상품+같은 옵션은 수량 합산. MK/FIVICS는 색/방향이 같은 productId(이름 안에 텍스트)라
    // 옵션으로 구분해야 서로 다른 색이 한 줄로 합쳐지지 않고 발주서에 어떤 옵션인지 남는다.
    // JVD는 색마다 productId가 달라 기존과 동일하게 동작.
    const productMap = new Map<string, { productId: number; quantity: number; unitCostJpy: number; optionMemo: string }>()
    for (const item of groupItems) {
      const p       = item.product
      const costJpy = (() => {
        let price = p.costPrice
        if (supplier.taxRate  > 0 && supplier.taxRate < 1) price /= (1 + supplier.taxRate)
        if (supplier.discount > 0 && supplier.discount < 1) price *= supplier.discount
        return Math.round(price * rate)
      })()
      const opt = item.optionMemo || ''
      const key = `${p.id}|${opt}`
      if (productMap.has(key)) {
        productMap.get(key)!.quantity += item.quantity
      } else {
        productMap.set(key, { productId: p.id, quantity: item.quantity, unitCostJpy: costJpy, optionMemo: opt })
      }
    }

    const poItems    = Array.from(productMap.values())
    const totalCost  = poItems.reduce((s, i) => s + i.unitCostJpy * i.quantity, 0)

    // PO 번호: 동시성·삭제 안전 채번 + 충돌 재시도
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')

    // 발주서 메모: 관련 주문 목록 자동 포함
    const orderNos = [...new Set(groupItems.map(i => i.order.orderNo))].join(', ')
    const autoMemo = `백오더 발주 (주문: ${orderNos})${memo ? '\n' + memo : ''}`

    const po = await createWithSeqRetry(
      (attempt) => nextPoNo(dateStr, attempt),
      (poNo) => prisma.purchaseOrder.create({
        data: {
          poNo,
          supplierCode,
          status:       'ordered',
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          totalCostJpy: totalCost,
          memo:         autoMemo,
          items: {
            create: poItems.map(i => ({
              productId:   i.productId,
              quantity:    i.quantity,
              unitCostJpy: i.unitCostJpy,
              memo:        i.optionMemo,   // 옵션(색/방향 등)을 발주 품목에 기록 → 발주서 표시
            })),
          },
        },
      }),
    )

    // OrderItem 업데이트: procureStatus → 'ordered', purchaseOrderId 연결
    await prisma.orderItem.updateMany({
      where: { id: { in: groupItems.map(i => i.id) } },
      data:  { procureStatus: 'ordered', purchaseOrderId: po.id },
    })

    createdPOs.push({ poNo: po.poNo, supplierCode, itemCount: groupItems.length })
  }

  return NextResponse.json({ created: createdPOs })
}
