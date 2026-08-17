// 발주 대상이 아닌 「서비스·실비」 SKU 판별.
//
// 스마레지에는 청구서 작성용으로 만든 항목이 섞여 있다 — 送料·交通費·加工費·事務手数料 등.
// 재고 개념이 없어 팔릴수록 재고가 마이너스로 내려가고(交通費 -503 등), 공급사에 발주할 상품도 없다.
// SKU 연결 화면에서 이런 걸 계속 보여주면 실제 작업 대상이 묻히므로 기본으로 제외한다.
//
// 판별은 스마레지 부문(category)을 1차 기준으로 한다 — 매장에서 이미 그렇게 분류해 두었고,
// 새 항목이 생겨도 같은 부문에 들어가면 자동으로 걸린다. 부문이 비어 있는 것만 이름으로 보완한다.
const SERVICE_CATEGORY = /事務処理系|加工費|サービス/
const SERVICE_NAME = /送料|交通費|加工費|諸費用|手数料|高速代金|コーチング|レッスン|会費|ガチャガチャ/

export function isServiceSku(sku: { name?: string | null; category?: string | null }): boolean {
  const cat = (sku.category ?? '').trim()
  if (cat && SERVICE_CATEGORY.test(cat)) return true
  return SERVICE_NAME.test(sku.name ?? '')
}
