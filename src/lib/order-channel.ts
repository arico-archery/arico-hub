// 주문이 어느 경로로 들어왔는지 — 판별 규칙을 한 곳에 둔다.
//
//   online   자사몰(MakeShop) 수신 — externalOrderNo 가 MakeShop 주문번호
//   invoice  청구서(오프라인) — 백필분은 externalOrderNo 가 'INV-<취引ID>'
//   manual   앱에서 손으로 등록 — 외부번호 없음
//
// 셋을 나누는 이유: 매출의 절반이 청구서 거래라, 섞여 있으면 "이번 달 자사몰이 어땠나"를
// 볼 수 없다. 채널마다 손이 가는 곳도 다르다(자사몰=자동수신, 청구서=수기입력·수금).

export const INVOICE_PREFIX = 'INV-'

export type OrderChannel = 'online' | 'invoice' | 'manual'

export function channelOf(o: { externalOrderNo?: string | null }): OrderChannel {
  const ext = o.externalOrderNo ?? ''
  if (!ext) return 'manual'
  return ext.startsWith(INVOICE_PREFIX) ? 'invoice' : 'online'
}

/** Prisma where 조각 — 목록·집계에서 같은 정의를 쓰도록. */
export function channelWhere(ch: string | null | undefined) {
  if (ch === 'online') return { AND: [{ externalOrderNo: { not: '' } }, { NOT: { externalOrderNo: { startsWith: INVOICE_PREFIX } } }] }
  if (ch === 'invoice') return { externalOrderNo: { startsWith: INVOICE_PREFIX } }
  if (ch === 'manual') return { externalOrderNo: '' }
  return null
}

export const CHANNEL_COLORS: Record<OrderChannel, string> = {
  online: '#3b82f6',   // blue — 자사몰
  invoice: '#8b5cf6',  // violet — 청구서
  manual: '#6b7280',   // gray — 수기
}
