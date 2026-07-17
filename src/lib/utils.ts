import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** JPY 금액 포맷: ¥1,234 */
export function formatJpy(amount: number): string {
  return `¥${Math.round(amount).toLocaleString('ja-JP')}`
}

/** 숫자 포맷 (콤마) */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('ja-JP')
}

/** 이익율 계산 (JPY 기준) */
export function calcProfitRate(saleJpy: number, costJpy: number) {
  if (saleJpy <= 0) return { wongarate: 0, margin: 0, profit: 0 }
  const wongarate = (costJpy / saleJpy) * 100
  const margin = ((saleJpy - costJpy) / saleJpy) * 100
  const profit = costJpy > 0 ? ((saleJpy - costJpy) / costJpy) * 100 : 0
  return { wongarate, margin, profit }
}

// 거래처 할인 계산: 소계 → 퍼센트(rate%) 먼저 차감 → 정액(amount) 추가 차감.
// 결과는 0 이상 소계 이하로 클램프. 반환값은 반올림된 할인액(JPY).
export function calcDiscount(subtotal: number, rate: number, amount: number): number {
  const byRate = subtotal * (Math.max(0, rate) / 100)
  const raw = Math.round(byRate) + Math.max(0, amount)
  return Math.min(Math.max(0, raw), Math.max(0, subtotal))
}

export function profitColor(margin: number): string {
  if (margin >= 40) return 'text-green-600'
  if (margin >= 25) return 'text-yellow-600'
  return 'text-red-600'
}

export function profitBgColor(margin: number): string {
  if (margin >= 40) return 'bg-green-500'
  if (margin >= 25) return 'bg-yellow-500'
  return 'bg-red-500'
}

// ── 공급처별 원가 계산 (JPY 환산) ──────────────────────────────
// 규칙:
//   SHIBUYA 공급처  (costPrice = 希望小売価格 税込)
//     └ SHIBUYA 자체 브랜드  → 希望小売価格(税込) × 0.62
//     └ 타 브랜드(HOYT, EASTON 등) → 希望小売価格(税込) × 0.65
//   외화 공급처 (JVD=USD, MK=USD, FIVICS=USD)
//     └ 원가 × 환율(→JPY) × 1.1  (엔화 환산 후 운송비+관세 10% 가산)
//   ANGEL (税抜 가격 그대로 저장)
//     └ クィーバー・ベルトネーム加工・トリートメント・ダビン → × 0.70
//     └ 그 외 → × 0.60
//   KOREA 등 JPY 공급처
//     └ supplier.taxRate 제거 + supplier.discount 적용
// ─────────────────────────────────────────────────────────────

// ANGEL 70% 적용 품목 키워드 (상품명에 포함 시 70% 掛率)
const ANGEL_70_PATTERN = /クィーバー|キャスター|ベルトネーム加工|トリートメント|ダビン/

export function calcCostJpy(
  p: {
    costPrice:    number
    brand:        string
    supplierCode: string
    name?:        string
    supplier: { currency: string; taxRate: number; discount: number }
  },
  rates: { currency: string; rateToJpy: number }[]
): number {
  const rateToJpy = rates.find(r => r.currency === p.supplier.currency)?.rateToJpy ?? 1
  let price = p.costPrice

  // 'SIBUYA'는 옛 코드 — SHIBUYA로 이름을 바로잡는 중이라 DB 이관이 끝날 때까지 함께 인정한다.
  // (인정하지 않으면 이관 도중 掛率 분기를 타지 못해 원가가 틀리게 계산된다) 이관 후 제거.
  if (p.supplierCode === 'SHIBUYA' || p.supplierCode === 'SIBUYA') {
    const isShibuyaBrand = /SHIBUYA|SIBUYA/i.test(p.brand)
    price = price * (isShibuyaBrand ? 0.62 : 0.65)              // 希望小売価格(税込) × 掛率
  } else if (p.supplierCode === 'ANGEL') {
    // 税抜 가격 그대로 저장된 상태 — 품목명으로 掛率 결정
    const is70 = ANGEL_70_PATTERN.test(p.name ?? '')
    price = price * (is70 ? 0.70 : 0.60)
  } else if (p.supplier.currency !== 'JPY') {
    // JVD(USD), MK(USD), FIVICS(USD) — 엔화 환산 후 10% 가산
    if (p.supplier.discount > 0 && p.supplier.discount < 1) {
      price = price * (1 - p.supplier.discount)
    }
    return Math.round(price * rateToJpy * 1.1)
  } else {
    // KOREA 등 JPY 공급처
    if (p.supplier.taxRate > 0 && p.supplier.taxRate < 1) price = price / (1 + p.supplier.taxRate)
    if (p.supplier.discount > 0 && p.supplier.discount < 1)     price = price * p.supplier.discount
  }

  return Math.round(price * rateToJpy)
}

export const SUPPLIER_COLORS: Record<string, string> = {
  ARICO: '#e11d48',  // ARICO 자체제작
  JVD: '#6366f1',
  MK: '#8b5cf6',
  FIVICS: '#3b82f6',
  SHIBUYA: '#0ea5e9',
  KOREA: '#10b981',
  ANGEL: '#f59e0b',
  WJ: '#f97316',
  KOWA: '#14b8a6',  // KOWA 광학
  ETC: '#64748b',  // 기타 브랜드 (수동 입력)
  // 옛 코드 SIBUYA → SHIBUYA 로 이름을 바로잡는 중. DB 이관이 끝날 때까지 색을 잃지 않도록 남겨둔다.
  // 이관 확인 후 이 줄은 지운다.
  SIBUYA: '#0ea5e9',
}

export const SUPPLIER_LIST = ['ARICO', 'JVD', 'MK', 'FIVICS', 'SHIBUYA', 'KOREA', 'ANGEL', 'WJ', 'KOWA', 'ETC'] as const
export type SupplierCode = typeof SUPPLIER_LIST[number]
