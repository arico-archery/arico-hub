import { prisma } from './prisma'

// 주문 옵션메모에서 스마레지 상품코드(=variationCustomCode) 추출. 코드형이 아니면 null.
export function extractOptionCode(memo: string | null | undefined): string | null {
  const m = String(memo || '').trim().replace(/^[#＃]/, '')
  return /^\d{10,14}$/.test(m) ? m : null
}

// 스마레지 상품 → 사람이 읽는 옵션 라벨 (사이즈/색상 우선, 없으면 상품명)
export function optionLabelFrom(sm: { name: string; size: string; color: string } | null | undefined): string {
  if (!sm) return ''
  const opt = [sm.size, sm.color].filter(Boolean).join(' / ')
  return opt || sm.name || ''
}

// 코드 목록 → {코드: 라벨} 맵 (배치 조회)
export async function resolveOptionLabels(memos: (string | null | undefined)[]): Promise<Map<string, string>> {
  const codes = [...new Set(memos.map(extractOptionCode).filter((c): c is string => !!c))]
  const map = new Map<string, string>()
  if (!codes.length) return map
  const rows = await prisma.smaregiProduct.findMany({
    where: { productCode: { in: codes } },
    select: { productCode: true, name: true, size: true, color: true },
  })
  for (const r of rows) map.set(r.productCode, optionLabelFrom(r))
  return map
}
