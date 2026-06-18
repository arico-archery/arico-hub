// JVD 변형 통합 유틸
// JVD 상품은 "상품코드 접두부(- 앞)"가 변형끼리 공유되고, 옵션(방향/파운드/길이/색상 등)은
// 상품명 끝에 붙는다. 예) 122211-1004 "Mathews Compound Bow ARC 30 RH 60#-25.0" 85% Let Off Black"
//   → 그룹키 122211, 베이스 "Mathews Compound Bow ARC 30", 옵션 "RH 60#-25.0" 85% Let Off Black"
// 데이터 전수 검증: 변형 그룹의 97.3%가 축→변형 1:1로 깔끔하게 파싱됨. 나머지는 원본 이름이
// 동일한 중복 코드라 코드 접미부를 라벨에 붙여 구분한다.

export type Axis = { label: string; values: string[] }
export type VariantOption = Record<string, string>

// 축 표시 순서 (방향 → 파운드 → 길이 → 렛오프 → 사이즈 → 색상 → 옵션/기타)
const AXIS_ORDER = ['방향', '파운드', '길이', '렛오프', '사이즈', '색상', '옵션']

// 변형 그룹 키. JVD는 코드 접두부, 그 외는 자기 코드(그룹핑 안 함).
export function groupCodeOf(supplierCode: string, productCode: string): string {
  if (supplierCode === 'JVD') {
    const i = productCode.indexOf('-')
    if (i > 0) return productCode.slice(0, i)
  }
  return productCode
}

// 그룹 내 이름들의 공통 선두 토큰 = 베이스명
export function commonBaseName(names: string[]): string {
  if (names.length === 0) return ''
  const toks = names.map(n => (n || '').trim().split(/\s+/))
  const first = toks[0]
  let k = 0
  for (; k < first.length; k++) {
    if (!toks.every(t => t[k] === first[k])) break
  }
  return first.slice(0, k).join(' ')
}

// 이름에서 베이스명을 떼어낸 옵션 문자열
export function optionStrOf(name: string, base: string): string {
  const n = name || ''
  return n.startsWith(base) ? n.slice(base.length).trim() : n
}

// 옵션 문자열을 축별 값으로 파싱
export function parseOption(optStr: string): VariantOption {
  const o: VariantOption = {}
  let s = ' ' + (optStr || '').trim() + ' '
  let m: RegExpMatchArray | null
  if ((m = s.match(/(?:^|\s)(LH|RH)(?:\s|$)/))) { o['방향'] = m[1]; s = s.replace(m[0], ' ') }
  if ((m = s.match(/(\d+)\s*#/))) { o['파운드'] = m[1] + '#'; s = s.replace(m[0], ' ') }
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*"/))) { o['길이'] = m[1] + '"'; s = s.replace(m[0], ' ') }
  if ((m = s.match(/(\d+)\s*%\s*Let\s*Off/i))) { o['렛오프'] = m[1] + '%'; s = s.replace(m[0], ' ') }
  if ((m = s.match(/(?:^|\s)(X-Large|XXL|XL|X-Small|XS|Junior|Large|Medium|Small)(?:\s|$)/))) { o['사이즈'] = m[1]; s = s.replace(m[0], ' ') }
  // 나머지 = 색상/기타. 분리자였던 하이픈 등 구두점만 남은 잔여물은 버린다.
  const rest = s.replace(/\s+/g, ' ').replace(/^[-–\s]+|[-–\s]+$/g, '').trim()
  if (rest && /[A-Za-z0-9]/.test(rest)) o['색상'] = rest
  return o
}

// SIBUYA 베이스명 = 이름에서 옵션값(사이즈/색상)을 제거한 것
export function sibuyaBaseName(name: string, size: string, color: string): string {
  let s = name || ''
  if (size) s = s.split(size).join('')
  if (color) s = s.split(color).join('')
  return s.replace(/\s+/g, ' ').trim()
}

// SIBUYA는 옵션이 필드(optionSize/optionColor)로 분리돼 있다. 필드값을 축으로 변환.
// optionSize는 방향(LH/RH)·사이즈(S/M/L)일 때도, "/50-60#/32.0"처럼 파운드+길이 묶음일 때도,
// 색상·스파인·규격 등 자유값일 때도 있다 → 인식되는 건 분리하고 나머지는 통째로 '옵션' 축에 보존.
export function parseSibuyaOption(size: string, color: string): VariantOption {
  const o: VariantOption = {}
  const s = (size || '').trim()
  if (/^(LH|RH)$/.test(s)) {
    o['방향'] = s
  } else if (/^(XS|S|M|L|XL|XXL|XXXL)$/.test(s)) {
    o['사이즈'] = s
  } else if (s) {
    let rest = ' ' + s + ' '
    let m: RegExpMatchArray | null
    if ((m = rest.match(/(\d+-\d+#|\d+#)/))) { o['파운드'] = m[1]; rest = rest.replace(m[0], ' ') }
    if ((m = rest.match(/(\d+\.\d+)/))) { o['길이'] = m[1] + '"'; rest = rest.replace(m[0], ' ') }
    rest = rest.replace(/[/\s]+/g, ' ').trim()
    if (!o['파운드'] && !o['길이']) o['옵션'] = s            // 파운드·길이 못 뽑음 → 원본 통째로
    else if (rest && /[가-힣A-Za-z]/.test(rest)) o['옵션'] = rest  // 묶음 분리 후 남은 의미값
  }
  if (color && color.trim()) o['색상'] = color.trim()
  return o
}

// 공급사별 변형 그룹 키. JVD=코드접두부, SIBUYA=베이스명, 그 외=자기 코드(그룹핑 안 함).
export function groupKeyOf(p: { supplierCode: string; productCode: string; name: string; optionSize: string; optionColor: string }): string {
  if (p.supplierCode === 'JVD') return groupCodeOf('JVD', p.productCode)
  if (p.supplierCode === 'SIBUYA') return 'SBY:' + sibuyaBaseName(p.name, p.optionSize, p.optionColor)
  return p.productCode
}

export type RawVariant = {
  id: number; productCode: string; name: string; brand: string; supplierCode: string
  costPrice: number; salePriceJpy: number; unit: string
  optionSize: string; optionColor: string
  supplier: { currency: string; taxRate: number; discount: number }
}

export type BuiltVariant = RawVariant & { options: VariantOption; optionLabel: string }
export type VariantGroup = { base: string; axes: Axis[]; variants: BuiltVariant[] }

// 코드 접두부 그룹(JVD)을 베이스명/축/변형으로 구조화
export function buildVariantGroup(rows: RawVariant[]): VariantGroup {
  const base = commonBaseName(rows.map(r => r.name))
  return assembleGroup(rows, base, r => parseOption(optionStrOf(r.name, base)))
}

// SIBUYA: 옵션 필드(optionSize/optionColor) 기반 그룹 구조화
export function buildSibuyaGroup(rows: RawVariant[]): VariantGroup {
  const base = sibuyaBaseName(rows[0].name, rows[0].optionSize, rows[0].optionColor)
  return assembleGroup(rows, base, r => parseSibuyaOption(r.optionSize, r.optionColor))
}

// 공용: 변형들을 옵션 파싱 → 라벨/충돌처리/축목록으로 구조화
function assembleGroup(rows: RawVariant[], base: string, getOpt: (r: RawVariant) => VariantOption): VariantGroup {
  const variants: BuiltVariant[] = rows.map(r => {
    const options = getOpt(r)
    const optionLabel = AXIS_ORDER.map(a => options[a]).filter(Boolean).join(' / ') || r.productCode
    return { ...r, options, optionLabel }
  })

  // 라벨 충돌(원본 옵션 동일) 시 코드 접미부로 구분
  const seen = new Map<string, number>()
  for (const v of variants) seen.set(v.optionLabel, (seen.get(v.optionLabel) || 0) + 1)
  for (const v of variants) {
    if ((seen.get(v.optionLabel) || 0) > 1) {
      const suffix = v.productCode.includes('-') ? v.productCode.slice(v.productCode.indexOf('-') + 1) : v.productCode
      v.optionLabel = `${v.optionLabel} (${suffix})`
    }
  }

  // 축 목록 (표시 순서대로, 값은 최초 등장 순)
  const map = new Map<string, string[]>()
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.options)) {
      if (!map.has(k)) map.set(k, [])
      if (!map.get(k)!.includes(val)) map.get(k)!.push(val)
    }
  }
  const labels = [...map.keys()].sort((a, b) => {
    const ia = AXIS_ORDER.indexOf(a), ib = AXIS_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const axes: Axis[] = labels.map(l => ({ label: l, values: map.get(l)! }))

  return { base, axes, variants }
}

// 선택된 축 값들로 변형 하나를 해결(resolve). 모든 선택 축이 일치하는 첫 변형.
export function resolveVariant(variants: BuiltVariant[], sel: Record<string, string>): BuiltVariant | null {
  const keys = Object.keys(sel).filter(k => sel[k])
  const matches = variants.filter(v => keys.every(k => v.options[k] === sel[k]))
  return matches.length === 1 ? matches[0] : (matches.length > 1 ? null : null)
}

// 캐스케이드: 앞선 축 선택과 양립 가능한 변형들로 한정했을 때, 주어진 축에서 고를 수 있는 값들
export function availableValues(variants: BuiltVariant[], axisLabel: string, sel: Record<string, string>): string[] {
  const others = Object.keys(sel).filter(k => k !== axisLabel && sel[k])
  const pool = variants.filter(v => others.every(k => v.options[k] === sel[k]))
  const out: string[] = []
  for (const v of pool) {
    const val = v.options[axisLabel]
    if (val && !out.includes(val)) out.push(val)
  }
  return out
}
