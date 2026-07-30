import { prisma } from './prisma'

// 스마레지/청구서에서 온 상품을 ARICO 카탈로그를 통해 '진짜 공급사'와 잇는다.
//
// 왜 필요한가: 스마레지에도 청구서에도 공급사 칸이 없다. 브랜드는 공급사가 아니다
// (AXCEL 은 JVD·SHIBUYA 양쪽에서 취급, HOYT 는 JVD 경유). 그래서 상품을 만들 때
// 공급사를 몰라 ETC(기타)로 넣으면, 공급사별 분석에서 ETC 가 최대 항목이 되어버린다.
//
// 다리 놓는 방법: 카탈로그는 대표상품 1개(「…9インチ」)로 등록되고, 스마레지는 같은 상품이
// 색상·방향별로 쪼개져 있다(「… RH ブラック」). 코드로는 못 잇는다 —
// 카탈로그=MakeShop 코드 / 스마레지=자체 바코드로 체계가 다르다.
// 그래서 이름에서 '옵션 꼬리'를 떼어낸 베이스명으로 대조한다.

// 무엇을 떼고 무엇을 남기는가 — 값이 같은 옵션만 뗀다.
//   뗀다: 방향(RH/LH) · 길이(9インチ) · 각도(40°) · 색상 · 사이즈(S/M/L)
//   남긴다: 소재(コードバン/バックスキン) · 수량(1ダース) · 스파인(450/550…)
//     실측: CORDOVAN 15.79USD vs 백스킨 4.51USD 로 3.5배 차이 → 떼면 엉뚱한 원가가 붙는다.
//     남겨두면 베이스명이 안 맞아 자동으로 건너뛰므로, 이게 안전판 역할을 한다.
// ※ \b(단어경계)는 일본어 뒤에서 작동하지 않는다 → 공백 기준으로 쓴다.
const OPTION_TAIL = /(^|[\s　])(RH|LH|右|左)([\s　]|$)|[\s　]*\d+(\.\d+)?(インチ|inch|in)[\s　]*|[\s　]*\d+(\.\d+)?°[\s　]*|(^|[\s　])(XS|S|M|L|XL|2XL|XXL)([\s　]|$)|ブラック|ホワイト|レッド|ブルー|グリーン|イエロー|オレンジ|パープル|シルバー|ゴールド|ピンク|ネイビー|ガンメタ|カメレオン\w*|グレー|バイオレット|ミント|スカイブルー|ライム|ターコイズ|ブロンズ|クリア|カモ/gi

/** 옵션 꼬리를 떼고 표기 흔들림(태그·공백)을 지운 비교용 이름. */
export function baseName(s: string | null | undefined): string {
  return String(s || '')
    .replace(/【[^】]*】/g, '')   // 【取寄せ商品】 같은 판매 태그
    .replace(OPTION_TAIL, ' ')
    .replace(/[\s　]+/g, '')
    .toLowerCase()
}

export type CatalogMatch = {
  supplierCode: string
  /** 공급사 통화 단위의 원가 — Product.costPrice 에 그대로 넣어야 calcCostJpy 가 맞는다 */
  costPrice: number
  brand: string
  /** 참고용: 어느 카탈로그를 타고 찾았는지 */
  via: string
}

/**
 * 이름으로 카탈로그를 찾아 공급사·원가·브랜드를 돌려준다. 확정할 수 없으면 null.
 *
 * 확정 못 하는 경우(그대로 ETC 로 둬야 한다):
 *  - 카탈로그에 없음
 *  - 공급사 후보가 갈림
 *  - 원가 후보가 갈림 → 이때는 공급사만 돌려주고 costPrice=0
 *    (예: 「アチーブXP PRO」는 9インチ 440.56USD / 6インチ 433.53USD 로 갈리는데
 *     스마레지 이름엔 인치 표기가 없어 어느 쪽인지 알 수 없다)
 */
export async function matchByCatalog(name: string): Promise<CatalogMatch | null> {
  const key = baseName(name)
  if (key.length < 4) return null

  // 진열 상품 중 공급사에 연결된 것만 후보
  const cats = await prisma.aricoCatalog.findMany({
    where: { supplierProductId: { not: null } },
    select: { name: true, supplierProductId: true },
  })
  const hitIds = cats.filter(c => baseName(c.name) === key).map(c => c.supplierProductId!)
  if (!hitIds.length) return null

  const sps = await prisma.product.findMany({
    where: { id: { in: [...new Set(hitIds)] } },
    select: { name: true, brand: true, supplierCode: true, costPrice: true },
  })
  if (!sps.length) return null

  const sups = new Set(sps.map(s => s.supplierCode))
  if (sups.size !== 1) return null                    // 공급사가 갈리면 사람이 판단해야 한다
  const costs = new Set(sps.filter(s => s.costPrice > 0).map(s => s.costPrice))
  const via = cats.find(c => baseName(c.name) === key)?.name ?? ''

  return {
    supplierCode: [...sups][0],
    costPrice: costs.size === 1 ? [...costs][0] : 0,   // 갈리면 0 — 통화가 달라 옛 값을 남기면 오해석된다
    brand: sps.find(s => s.brand)?.brand ?? '',
    via,
  }
}
