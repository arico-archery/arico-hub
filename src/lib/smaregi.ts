// Smaregi 재고 연동 인터페이스.
// ⚠️ API 키 제공 전까지 스텁(빈 결과) — API 들어오면 이 파일의 함수 내부만 실제 호출로 교체하면 됨.
// 연결 키 = 바코드(JAN). Smaregi가 재고 SSOT, MakeShop↔Smaregi는 이미 연동됨.

export type StockMap = Map<string, number> // barcode(JAN) → 재고수량

export const SMAREGI_ENABLED = false // API 연동되면 true

/**
 * 바코드 목록의 현재 재고를 조회한다.
 * TODO(API): Smaregi 플랫폼 API(재고 조회)로 교체.
 *   - 인증: 발급된 토큰/계약 정보 사용
 *   - 엔드포인트: 상품 재고(stock) 조회, JAN/상품코드로 필터
 *   - 반환: barcode → quantity 맵
 */
export async function getStockByBarcodes(barcodes: string[]): Promise<StockMap> {
  void barcodes
  if (!SMAREGI_ENABLED) return new Map()
  // 실제 구현 자리 (API 제공 시)
  return new Map()
}

/** 단일 바코드 재고 (없으면 null = 미연동/미등록) */
export async function getStock(barcode: string): Promise<number | null> {
  if (!barcode || !SMAREGI_ENABLED) return null
  const m = await getStockByBarcodes([barcode])
  return m.get(barcode) ?? null
}
