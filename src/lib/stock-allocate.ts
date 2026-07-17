import { prisma } from './prisma'
import { extractOptionCode } from './smaregi-option'

// 스마레지 재고로 주문을 충당할 수 있는지 판단하는 계산.
//
// 두 트랙:
//   재고가 있으면  → 발주하지 않고 그 재고로 보낸다 (procureStatus=received, stockAllocated=true)
//   재고가 모자라면 → 모자란 만큼만 백오더(needed)로 남긴다
//
// 중복 배정 방지가 핵심이다. 스마레지 재고 22개를 보고 세 주문을 다 빼면 실제론 모자란다.
// 그래서 "이미 충당했지만 아직 발송 안 한 수량"을 재고에서 뺀 것을 가용 재고로 본다.
//   가용 = 스마레지 재고 − 미발송 충당분
// 발송하면 충당분에서 빠지고, 그 무렵 스마레지에서도 판매 등록돼 재고가 준다 → 이중으로 세지 않는다.

/** 코드 → 가용 수량. 스마레지 재고에서 아직 발송하지 않은 충당분을 뺀 값. */
export async function availableByCode(): Promise<Map<string, number>> {
  const [sms, allocated] = await Promise.all([
    prisma.smaregiProduct.findMany({ select: { productCode: true, stock: true } }),
    // 이미 재고로 충당했지만 아직 고객에게 못 보낸 품목 = 그 재고는 임자가 있다
    prisma.orderItem.findMany({
      where: {
        stockAllocated: true,
        order: { shippingDate: null, status: { notIn: ['cancelled', 'delivered'] } },
      },
      select: { quantity: true, optionMemo: true },
    }),
  ])
  const avail = new Map<string, number>()
  for (const s of sms) avail.set(s.productCode, s.stock)
  for (const a of allocated) {
    const c = extractOptionCode(a.optionMemo)
    if (c && avail.has(c)) avail.set(c, (avail.get(c) ?? 0) - a.quantity)
  }
  return avail
}

/**
 * 한 품목을 재고로 얼마나 충당할 수 있는지 정하고, 남은 가용 재고를 깎는다.
 * 같은 수신 안에서 여러 주문이 같은 상품을 원할 때 이중 배정되지 않도록 avail을 직접 줄인다.
 *
 * @returns fromStock 재고로 보낼 수량 · toOrder 발주해야 할 수량
 */
export function allocate(
  avail: Map<string, number>,
  optionMemo: string | null | undefined,
  quantity: number,
): { fromStock: number; toOrder: number; code: string | null } {
  const code = extractOptionCode(optionMemo)
  if (!code) return { fromStock: 0, toOrder: quantity, code: null }   // 재고를 볼 수 없는 품목(取寄せ 등)
  const have = avail.get(code)
  if (have === undefined || have <= 0) return { fromStock: 0, toOrder: quantity, code }
  const fromStock = Math.min(have, quantity)
  avail.set(code, have - fromStock)
  return { fromStock, toOrder: quantity - fromStock, code }
}
