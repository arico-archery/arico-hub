// 재고 2-lane 분기 — 주문 시 재고를 보고 품목을 두 갈래로 나눈다.
// - 재고있음 → 'from_stock' (재고 차감, 발주 없이 바로 배송대기)
// - 재고없음/부족 → 'needed' (기존 발주 루프)
// 부분 재고면 한 줄이 from_stock + needed 두 줄로 분리된다(품목 단위 분기).

export type StockItemInput = {
  productId: number; quantity: number
  salePriceJpy: number; costPriceJpy: number; optionMemo?: string
  catalogId?: number | null
}
export type PlannedItem = StockItemInput & { procureStatus: 'from_stock' | 'needed' }

// stockMap: productId → 현재 가용재고. 같은 상품이 여러 줄이면 순차 차감.
export function planAllocation(
  items: StockItemInput[],
  stockMap: Record<number, number>,
): { items: PlannedItem[]; decrements: Record<number, number> } {
  const remaining: Record<number, number> = { ...stockMap }
  const decrements: Record<number, number> = {}
  const out: PlannedItem[] = []

  for (const it of items) {
    const avail = Math.max(0, remaining[it.productId] ?? 0)
    const fromStock = Math.min(avail, it.quantity)
    if (fromStock > 0) {
      out.push({ ...it, quantity: fromStock, procureStatus: 'from_stock' })
      remaining[it.productId] = avail - fromStock
      decrements[it.productId] = (decrements[it.productId] ?? 0) + fromStock
    }
    const need = it.quantity - fromStock
    if (need > 0) out.push({ ...it, quantity: need, procureStatus: 'needed' })
  }
  return { items: out, decrements }
}

// 품목이 "재고에서 출고됨(이미 차감)" 상태인지 — 발송 시 추가 차감 금지 판단용
export const FROM_STOCK = 'from_stock'
// 품목이 "손에 있음(출고 가능)" 상태인지 — 배송대기/단계표시용
export const IN_HAND_STATUSES = ['received', 'from_stock']
