import { prisma } from './prisma'
import { extractOptionCode } from './smaregi-option'

// SKU 3단 연결(카탈로그[상품군] → 스마레지[SKU] → 공급사[변형])의 카탈로그 링크 자동 기록.
//
// 주문을 받는 순간 우리는 이미 "이 옵션코드는 이 카탈로그 상품의 것"임을 알고 있다
// (카탈로그로 상품을 찾아 품목을 만들기 때문). 그 사실을 SmaregiProduct.catalogId 에 남겨두면
// 처음 팔린 상품도 다음 순간부터 /sku-links 에서 공급사 변형을 확정할 수 있다.
//
// 원칙:
//  - catalogId 만 기록한다. supplierProductId(발주 대상)는 절대 자동으로 넣지 않는다 — 사람 확정 전용.
//  - 이미 값이 있으면 덮어쓰지 않는다(사람이 고쳤을 수 있다).

/** 옵션코드 → 카탈로그 매핑을 SmaregiProduct 에 기록. 반환 = 새로 연결된 건수. */
export async function linkSkusToCatalog(pairs: { optionMemo: string; catalogId: number }[]): Promise<number> {
  // 코드별로 하나의 카탈로그만 인정 — 같은 코드가 서로 다른 카탈로그로 오면 판단 불가라 건너뛴다
  const byCode = new Map<string, number | null>()
  for (const p of pairs) {
    const code = extractOptionCode(p.optionMemo)
    if (!code || !p.catalogId) continue
    if (byCode.has(code) && byCode.get(code) !== p.catalogId) byCode.set(code, null)
    else if (!byCode.has(code)) byCode.set(code, p.catalogId)
  }
  const codes = [...byCode.entries()].filter(([, v]) => v != null) as [string, number][]
  if (!codes.length) return 0

  // 아직 카탈로그가 없는 SKU만 대상
  const rows = await prisma.smaregiProduct.findMany({
    where: { productCode: { in: codes.map(([c]) => c) }, catalogId: null },
    select: { id: true, productCode: true },
  })
  if (!rows.length) return 0
  const catByCode = new Map(codes)
  let n = 0
  for (const r of rows) {
    const catalogId = catByCode.get(r.productCode)
    if (!catalogId) continue
    try {
      await prisma.smaregiProduct.update({ where: { id: r.id }, data: { catalogId } })
      n++
    } catch { /* 개별 실패는 수신 전체를 막지 않는다 */ }
  }
  return n
}
