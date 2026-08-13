// 스마레지 SKU ↔ 공급사 변형의 옵션 대조 (SKU 연결 화면의 「추천」 판정).
//
// 어려운 점: 스마레지 이름은 일본어 카타카나(クリアレッド), 공급사 변형의 옵션은 영어 약어(RED)라
// 문자열로는 절대 안 겹친다. 그래서 양쪽을 영어 토큰 집합으로 바꿔 비교한다.
//
// 판정은 「변형의 토큰이 SKU 토큰에 전부 포함되면 추천」(부분집합). 이게 중요한 이유:
//   クリアピンク{clear,pink} 에 대해 PINK{pink} 는 추천되고 OPAQUE PINK{opaque,pink} 는 제외된다.
//   반대로 확신이 없는 조합(クリアグリーン{clear,green} vs LIGHT GREEN{light,green})은
//   추천하지 않고 사람이 고르게 둔다 — 틀린 추천을 띄우는 것보다 안 띄우는 편이 안전하다.

const KANA_TOKEN: [RegExp, string][] = [
  // 수식어
  [/オブリック|オペーク/g, 'opaque'],
  [/クリア[ーァ]?/g, 'clear'],
  [/ライト|ライ[トド]/g, 'light'],
  [/ダーク/g, 'dark'],
  // 색
  [/レッド|赤/g, 'red'],
  [/ブルー|青/g, 'blue'],
  [/グリーン|緑/g, 'green'],
  [/イエロー|黄/g, 'yellow'],
  [/ピンク/g, 'pink'],
  [/パープル|バイオレット|紫/g, 'purple'],
  [/オレンジ/g, 'orange'],
  [/ホワイト|白/g, 'white'],
  [/ブラック|黒/g, 'black'],
  [/シルバー|銀/g, 'silver'],
  [/ゴールド|金/g, 'gold'],
  [/グレ[ーイ]|ガンメタ[ルリ]?/g, 'gray'],
  [/ブラウン|茶/g, 'brown'],
  [/ネイビー/g, 'navy'],
  [/ミント/g, 'mint'],
  [/ライム/g, 'lime'],
  [/カモ/g, 'camo'],
  // 방향·사이즈는 그대로 쓰되 표기만 통일
  [/右|ライトハンド/g, 'rh'],
  [/左|レフトハンド/g, 'lh'],
]

const EN_ALIAS: [RegExp, string][] = [
  [/\bl[-\s.·]?grn\b/g, 'light green'],
  [/\borng\b/g, 'orange'],
  [/\bppl?\b/g, 'purple'],
  [/\bbl\b/g, 'blue'],
  [/\brd\b/g, 'red'],
  [/\bwt\b|\bwht\b/g, 'white'],
  [/\bbk\b|\bblk\b/g, 'black'],
  [/\bylw\b|\byel\b/g, 'yellow'],
  [/\bpk\b/g, 'pink'],
  [/\bgrn\b/g, 'green'],
  // O-PK, O·WT … = OPAQUE. 구분자를 반드시 요구한다 — 안 그러면 ORANGE/OPAQUE 의 첫 글자까지 먹는다.
  [/\bo[-.·]/g, 'opaque '],
]

/** 문자열을 옵션 토큰 집합으로 (일/영 표기 차이를 흡수). */
export function optionTokens(s: string): Set<string> {
  let t = String(s || '').normalize('NFKC').toLowerCase()
  for (const [re, en] of EN_ALIAS) t = t.replace(re, ` ${en} `)
  for (const [re, en] of KANA_TOKEN) t = t.replace(re, ` ${en} `)
  const out = new Set<string>()
  for (const w of t.split(/[^a-z0-9]+/)) {
    // 한 글자 토큰은 사이즈(S/M/L)만 인정한다. 이걸 버리면 RH/M 과 RH/L 이 둘 다 {rh} 가 되어
    // 구분이 안 된다(실제로 SAKER2 탭에서 두 후보가 동시에 추천됐다).
    // 숫자만인 토큰은 계속 제외 — 스파인 범위 표기가 양쪽에서 다르기 때문(700~1000 vs 650~1000).
    if (w.length === 1) { if (/^[sml]$/.test(w)) out.add(w); continue }
    if (/[a-z]/.test(w)) out.add(w)
  }
  return out
}

/**
 * 변형이 이 SKU 의 옵션에 해당하는가 (추천 여부).
 * 변형 쪽 토큰이 비어 있으면(옵션 정보 없음) 추천하지 않는다.
 */
export function matchesOption(skuText: string, variantText: string): boolean {
  return optionMatchScore(skuText, variantText) > 0
}

/**
 * 일치 점수 = 맞으면 변형 토큰 수, 아니면 0.
 * 「더 구체적인 쪽」을 고르는 데 쓴다 — オブリックピンク 는 OPAQUE PINK(2) 와 PINK(1) 둘 다
 * 부분집합이지만, 추천해야 하는 건 OPAQUE PINK 다.
 */
export function optionMatchScore(skuText: string, variantText: string): number {
  const sku = optionTokens(skuText)
  const v = optionTokens(variantText)
  if (v.size === 0 || sku.size === 0) return 0
  for (const w of v) if (!sku.has(w)) return 0
  return v.size
}
