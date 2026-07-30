import { prisma } from './prisma'
import { calcCostJpy } from './utils'

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

// 무엇을 떼는가 — 카탈로그는 대표상품 1개로 등록되고 스마레지는 옵션별로 쪼개지므로,
// 그 '쪼개는 축'을 뗀다: 방향(RH/LH) · 길이(9インチ) · 각도(40°) · 사이즈(S/M/L) · 색상
//   + 규격숫자(스파인 450/550…) — 실측: JVD X10 샤프트는 380/410/1000 전부 378.09USD 로 같다
//   + 수량(1ダース/1枚) — 카탈로그가 【ダース販売】를 태그로 달고 있어 떼야 이어진다
//
// 남긴다: 소재(コードバン/バックスキン) — CORDOVAN 15.79USD vs 백스킨 4.51USD 로 3.5배 차이.
//   남겨두면 베이스명이 안 맞아 자동으로 건너뛰므로 이게 안전판이 된다.
//
// ⚠️ 수량을 떼면 「1枚」이 「50枚入」 카탈로그에 붙을 수 있다(실측: 판매¥52 vs 원가¥1,645).
//   그래서 원가를 쓰기 전에 반드시 판매가와 비교해 걸러야 한다 → isCostSane()
// ※ \b(단어경계)는 일본어 뒤에서 작동하지 않는다 → 공백 기준으로 쓴다.
const OPTION_TAIL = new RegExp(
  '(^|[\\s　])(RH|LH|右|左)([\\s　]|$)' +
  '|[\\s　]*\\d+(\\.\\d+)?(インチ|inch|in)[\\s　]*' +
  '|[\\s　]*\\d+(\\.\\d+)?°[\\s　]*' +
  '|(^|[\\s　])(XS|S|M|L|XL|2XL|XXL)([\\s　]|$)' +
  '|ブラック|ホワイト|レッド|ブルー|グリーン|イエロー|オレンジ|パープル|シルバー|ゴールド|ピンク|ネイビー|ガンメタ|カメレオン\\w*|グレー|バイオレット|ミント|スカイブルー|ライム|ターコイズ|ブロンズ|クリア|カモ' +
  '|[（(]?\\d+\\s*(ダース|枚|本|個|セット)[）)]?' +
  '|(^|[\\s　])\\d{2,4}([\\s　]|$)', 'gi')

/**
 * 원가가 판매가에 비추어 말이 되는지 — 카탈로그 오매칭·단위 불일치를 걸러낸다.
 * 마진 70% 이상 = 원가 과소(오매칭 의심). 원가가 판매가의 1.2배 초과 = 원가 과대(수량·단위 불일치).
 * 약간의 역마진(¥5,760 원가를 ¥5,729 에 판매)은 실제로 있어서 막지 않는다 —
 * 걸러야 할 것은 「1枚 판매 ¥52 vs 50枚 원가 ¥1,645」 같은 자릿수 차이다.
 */
export function isCostSane(costJpy: number, salePriceJpy: number): boolean {
  if (costJpy <= 0) return false
  if (salePriceJpy <= 0) return true            // 판매가가 없으면 판단 근거가 없다 → 통과
  const margin = (salePriceJpy - costJpy) / salePriceJpy * 100
  return margin < 70 && costJpy <= salePriceJpy * 1.2
}

/** 옵션 꼬리를 떼고 표기 흔들림(태그·공백)을 지운 비교용 이름. */
export function baseName(s: string | null | undefined): string {
  let t = String(s || '').replace(/【[^】]*】/g, '')   // 【取寄せ商品】 같은 판매 태그
  // 옵션이 연달아 붙으면(「RH L」) 첫 매칭이 사이 공백을 소비해 다음 옵션이 안 지워진다
  // (실측: 「SAKER 1 タブ RH L」의 L 이 남아 매칭 실패) → 변화가 없을 때까지 반복한다.
  for (let i = 0; i < 5; i++) {
    const next = t.replace(OPTION_TAIL, ' ')
    if (next === t) break
    t = next
  }
  return t.replace(/[\s　]+/g, '').toLowerCase()
}

export type CatalogMatch = {
  supplierCode: string
  /** 공급사 통화 단위의 원가 — Product.costPrice 에 그대로 넣어야 calcCostJpy 가 맞는다 */
  costPrice: number
  /** 위 값을 공급사 규칙으로 환산한 JPY — isCostSane() 으로 검증할 때 쓴다 */
  costJpy: number
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
    select: { name: true, brand: true, supplierCode: true, costPrice: true, supplier: { select: { currency: true, taxRate: true, discount: true } } },
  })
  if (!sps.length) return null

  const sups = new Set(sps.map(s => s.supplierCode))
  if (sups.size !== 1) return null                    // 공급사가 갈리면 사람이 판단해야 한다
  const rates = await prisma.exchangeRate.findMany({ select: { currency: true, rateToJpy: true } })
  // JPY 환산값으로 후보를 모은다 — 같은 상품의 옵션이면 값이 하나로 모인다
  const byJpy = new Map<number, number>()   // JPY → 공급사 통화 원본
  for (const s of sps) {
    if (s.costPrice <= 0) continue
    byJpy.set(Math.round(calcCostJpy(s, rates)), s.costPrice)
  }
  const single = byJpy.size === 1 ? [...byJpy.entries()][0] : null
  const via = cats.find(c => baseName(c.name) === key)?.name ?? ''

  return {
    supplierCode: [...sups][0],
    // 후보가 갈리면 0 — 통화 단위가 달라 옛 값을 남기면 오해석된다(¥24,244 → $24,244)
    costPrice: single ? single[1] : 0,
    costJpy: single ? single[0] : 0,
    brand: sps.find(s => s.brand)?.brand ?? '',
    via,
  }
}
