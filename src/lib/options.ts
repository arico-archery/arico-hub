// 옵션 표준어 사전 — 색/사이즈/방향/무게를 언어·표기(ja/en/ko/약어) 무관 정규값으로 통일.
// 변형(SKU) 매칭·일원화의 "결정론적 키" 생성에 사용한다.
// 퍼지 이름매칭 대신, 옵션을 정규화해 시그니처로 비교 → 색/사이즈/방향이 같으면 같은 변형.

export type OptionAxis = 'color' | 'size' | 'direction' | 'weight' | 'spine' | 'other'

export type CanonOption = { axis: OptionAxis; canon: string; raw: string }

// ── 색상: canonical(영문) ← 동의어(영/일/한/약어) ────────────────────
const COLOR_SYNONYMS: Record<string, string[]> = {
  black:   ['black', 'blk', 'bk', 'ブラック', '黒', '블랙', '검정', '검정색', '블'],
  white:   ['white', 'wht', 'wh', 'ホワイト', '白', '화이트', '흰색'],
  red:     ['red', 'rd', 'レッド', '赤', '빨강', '레드'],
  blue:    ['blue', 'bl', 'ブルー', '青', '블루', '파랑'],
  navy:    ['navy', 'nv', 'ネイビー', '紺', '네이비'],
  green:   ['green', 'grn', 'gr', 'グリーン', '緑', '그린', '초록'],
  yellow:  ['yellow', 'ylw', 'yl', 'イエロー', '黄', '옐로우', '노랑'],
  orange:  ['orange', 'org', 'or', 'オレンジ', '오렌지', '주황'],
  pink:    ['pink', 'pk', 'ピンク', '핑크', '분홍'],
  purple:  ['purple', 'ppl', 'pp', 'パープル', '紫', '퍼플', '보라'],
  silver:  ['silver', 'slv', 'シルバー', '銀', '실버', '은색'],
  gold:    ['gold', 'gd', 'ゴールド', '金', '골드', '금색'],
  gray:    ['gray', 'grey', 'gy', 'グレー', '灰', '그레이', '회색'],
  brown:   ['brown', 'bwn', 'ブラウン', '茶', '브라운', '갈색'],
  clear:   ['clear', 'クリア', '투명', '클리어'],
  carbon:  ['carbon', 'カーボン', '카본'],
}

// ── 사이즈: canonical ← 동의어 ───────────────────────────────────
const SIZE_SYNONYMS: Record<string, string[]> = {
  xs:  ['xs', 'エックスエス', '엑스스몰'],
  s:   ['s', 'small', 'スモール', 'エス', '스몰', '소'],
  m:   ['m', 'medium', 'ミディアム', 'エム', '미디엄', '중'],
  l:   ['l', 'large', 'ラージ', 'エル', '라지', '대'],
  xl:  ['xl', 'エックスエル', '엑스라지'],
  xxl: ['xxl', '2xl'],
}

// ── 방향: canonical ← 동의어 ─────────────────────────────────────
const DIRECTION_SYNONYMS: Record<string, string[]> = {
  rh: ['rh', 'right', 'r/h', 'r', '右', '右手', '오른손', '오른', '우'],
  lh: ['lh', 'left', 'l/h', 'l', '左', '左手', '왼손', '왼', '좌'],
}

function buildLookup(dict: Record<string, string[]>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [canon, syns] of Object.entries(dict)) {
    m.set(canon, canon)
    for (const s of syns) m.set(s.toLowerCase(), canon)
  }
  return m
}

const COLOR_LOOKUP = buildLookup(COLOR_SYNONYMS)
const SIZE_LOOKUP = buildLookup(SIZE_SYNONYMS)
const DIR_LOOKUP = buildLookup(DIRECTION_SYNONYMS)

const clean = (s: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export function canonColor(raw: string): string | null {
  return COLOR_LOOKUP.get(clean(raw)) ?? null
}
export function canonSize(raw: string): string | null {
  return SIZE_LOOKUP.get(clean(raw)) ?? null
}
export function canonDirection(raw: string): string | null {
  return DIR_LOOKUP.get(clean(raw)) ?? null
}

// 무게/스파인/포000 등 수치형: 숫자+단위 정규화 (예: "100gr" → weight:100, "1500" → spine:1500)
const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(gr|grain|グレイン|g|그레인)/i
const SPINE_RE = /\bspine\b|スパイン|스파인/i
const POUND_RE = /(\d+(?:\.\d+)?)\s*(lbs?|#|ポンド|파운드)/i
const INCH_RE = /(\d+(?:\.\d+)?)\s*(?:"|inch|インチ|인치)/i

// 단일 옵션값 1개를 축+정규값으로 해석. 못 맞추면 axis='other', canon=정리된 원문
export function normalizeOptionValue(raw: string, labelHint = ''): CanonOption {
  const v = clean(raw)
  const hint = clean(labelHint)

  const dir = canonDirection(v); if (dir) return { axis: 'direction', canon: dir, raw }
  const col = canonColor(v); if (col) return { axis: 'color', canon: col, raw }
  const sz = canonSize(v); if (sz) return { axis: 'size', canon: sz, raw }

  let m: RegExpMatchArray | null
  if ((m = v.match(WEIGHT_RE))) return { axis: 'weight', canon: `${parseFloat(m[1])}gr`, raw }
  if ((m = v.match(POUND_RE)))  return { axis: 'weight', canon: `${parseFloat(m[1])}lb`, raw }
  if ((m = v.match(INCH_RE)))   return { axis: 'size', canon: `${parseFloat(m[1])}in`, raw }
  if (SPINE_RE.test(hint) || SPINE_RE.test(v)) {
    const num = v.match(/\d{3,4}/)
    if (num) return { axis: 'spine', canon: `${num[0]}`, raw }
  }
  // 라벨 힌트로 축 추정 (색/サイズ/カラー 등)
  if (/(color|カラー|색|색상)/.test(hint)) return { axis: 'color', canon: v, raw }
  if (/(size|サイズ|사이즈)/.test(hint))  return { axis: 'size', canon: v, raw }
  return { axis: 'other', canon: v, raw }
}

// optionMemo/자유텍스트에서 토큰 추출 → 정규 옵션 배열 (구분자: / , · 공백 괄호)
export function parseOptions(text: string): CanonOption[] {
  if (!text) return []
  const tokens = text
    .split(/[\/,·|()[\]{}]+|\s{2,}/)
    .map(t => t.trim())
    .filter(Boolean)
  const out: CanonOption[] = []
  const seen = new Set<string>()
  for (const tok of tokens) {
    // "라벨: 값" 형태면 분리
    const kv = tok.split(/[:：]/)
    const label = kv.length > 1 ? kv[0] : ''
    const value = kv.length > 1 ? kv.slice(1).join(':') : tok
    for (const part of value.split(/\s+/)) {
      const c = normalizeOptionValue(part, label)
      const key = `${c.axis}:${c.canon}`
      if (c.canon && !seen.has(key)) { seen.add(key); out.push(c) }
    }
  }
  return out
}

// 변형 시그니처 — 같은 변형이면 같은 문자열 (축 순서 고정, canon 정렬).
// 예: color=black,size=m,direction=rh → "color=black|direction=rh|size=m"
const AXIS_ORDER: OptionAxis[] = ['color', 'size', 'direction', 'weight', 'spine', 'other']
export function optionSignature(opts: CanonOption[]): string {
  const byAxis = new Map<OptionAxis, string[]>()
  for (const o of opts) {
    if (!byAxis.has(o.axis)) byAxis.set(o.axis, [])
    byAxis.get(o.axis)!.push(o.canon)
  }
  return AXIS_ORDER
    .filter(a => byAxis.has(a))
    .map(a => `${a}=${[...new Set(byAxis.get(a)!)].sort().join(',')}`)
    .join('|')
}

// 자유텍스트 두 개의 옵션이 같은 변형을 가리키는지 (시그니처 비교)
export function sameVariant(textA: string, textB: string): boolean {
  const a = optionSignature(parseOptions(textA))
  const b = optionSignature(parseOptions(textB))
  return a !== '' && a === b
}
