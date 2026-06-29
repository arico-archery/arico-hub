// 옵션 표준어 사전 (ja ↔ en) + 변형 자동 해결.
// 들어온 주문 옵션(일본어, 예: グラファイトブラック)을 공급사 변형 축값(영어, 예: Graphite Black)에
// 매핑해 정확한 SKU를 결정론적으로 찾는다. (MakeShop 주문 자동유입 시 사용)
//
// 사전은 점진 확장한다. 매칭 우선순위: ①정규화 완전일치 ②사전(ja→en) ③en 정규화 일치.
// 새 색상이 나오면 COLOR_JA_EN에 한 줄 추가하면 된다.

// 색상 카타카나 → 영어. 데이터에서 확인된 페어 + 표준색.
// ※ 사전 항목이 틀려도 안전: matchAxisValue는 변환된 영어가 실제 축값과 정확히 일치할 때만 채택,
//    아니면 null(미해결)로 떨어진다 → 오매칭 불가. 그래서 후보를 넉넉히 넣어도 됨.
export const COLOR_JA_EN: Record<string, string> = {
  // 표준색
  'ブラック': 'Black', 'レッド': 'Red', 'ブルー': 'Blue', 'ホワイト': 'White',
  'グリーン': 'Green', 'イエロー': 'Yellow', 'パープル': 'Purple', 'オレンジ': 'Orange',
  'シルバー': 'Silver', 'ゴールド': 'Gold', 'ピンク': 'Pink', 'ミント': 'Mint',
  'チャコール': 'Charcoal', 'グレー': 'Gray', 'グレイ': 'Gray', 'ネイビー': 'Navy',
  'ブラウン': 'Brown', 'クリア': 'Clear', 'カーボンブラック': 'Carbon Black',
  // WIAWIS 핸들 팔레트
  'グラファイトブラック': 'Graphite Black', 'ブラック/ゴールド': 'Black/Gold',
  'ブラック/レッド': 'Black/Red', 'バーガンディレッド': 'Burgandy Red',
  'ヒートブルー': 'Heat Blue', 'インディゴブルー': 'Indigo Blue',
  'メタリックシルバー': 'Metallic Silver', 'ブリリアントシルバー': 'Brilliant Silver',
  'ブリリアントブルー': 'Brilliant Blue', 'ミスティックバイオレット': 'Mystic Violet',
  'レーシングカーキ': 'Racing Khaki', 'ソニックレッド': 'Sonic Red',
  'ストーンベージュ': 'Stone Beige', 'ストーンミント': 'Stone Mint',
  'サンオレンジ': 'Sun Orange', 'ターキーグリーン': 'Turkey Green',
  'チタニウムシルバー': 'Titanium Silver',
  // 컴파운드(Mathews 등) 마케팅 색 — 추정 스펠링(틀려도 미해결로 안전)
  'リキッドブラック': 'Liquid Black', 'インパクトブルー': 'Impact Blue',
  'ポーラーホワイト': 'Polar White', 'ブルーオンブラック': 'Blue on Black',
  'レッドフレア': 'Red Flare', 'サッシーピンク': 'Sassy Pink',
  'パーフェクトオレンジ': 'Perfect Orange', 'ツイステッドグリーン': 'Twisted Green',
}

// 방향(左右) 정규화. 두 데이터셋 모두 RH/LH를 쓰지만, 일본어 표기 변형도 흡수.
export function normalizeDirection(v: string): string {
  const s = (v || '').trim()
  if (/(^|[^A-Za-z])RH([^A-Za-z]|$)|右/i.test(s) || /^R$/i.test(s)) return 'RH'
  if (/(^|[^A-Za-z])LH([^A-Za-z]|$)|左/i.test(s) || /^L$/i.test(s)) return 'LH'
  return s
}

// 비교용 정규화: 소문자 + 파운드/인치 표기 통일 + 공백 제거.
// '.'·내부 '/'·'-'·'#'·'"'는 보존(길이 32.0, 색 Black/Gold, 파운드 40-50# 구분 위해).
function norm(s: string): string {
  return (s || '').trim().toLowerCase()
    .replace(/ポンド/g, '#')          // 65ポンド → 65#
    .replace(/\blbs?\b/g, '#')        // 65lbs → 65#
    .replace(/^\/+/, '')              // 선두 슬래시 (/40-50# → 40-50#)
    .replace(/''/g, '"')              // 두 어포스트로피 → 인치
    .replace(/[”″]/g, '"')            // 전각 인치 기호
    .replace(/\s+/g, '')              // 공백
}

// 순수 숫자(+단위기호)면 수치 반환, 아니면 null. 범위(40-50#)·문자색은 제외 → 오매칭 방지.
function numericVal(s: string): number | null {
  const t = (s || '').trim().replace(/ポンド/g, '#')
  if (!/^[\d.]+["#”″']*$/.test(t)) return null
  const n = parseFloat(t)
  return isNaN(n) ? null : n
}

// 들어온 옵션값(주로 ja)을 후보 축값들(공급사 표기, 주로 en) 중 하나로 해결. 못 찾으면 null.
export function matchAxisValue(incoming: string, candidates: string[]): string | null {
  const inc = (incoming || '').trim()
  if (!inc) return null
  // ① 정규화 완전일치 (파운드 ポンド↔#, 공백 무시 등)
  const ninc = norm(inc)
  for (const c of candidates) if (norm(c) === ninc) return c
  // ② 사전(ja→en) 후 일치
  const en = COLOR_JA_EN[inc]
  if (en) {
    const nen = norm(en)
    for (const c of candidates) if (norm(c) === nen) return c
  }
  // ③ 방향 정규화 후 일치 (右/左/RH/LH)
  const nd = norm(normalizeDirection(inc))
  for (const c of candidates) if (norm(normalizeDirection(c)) === nd) return c
  // ④ 숫자형(길이/파운드 단일값) 관용 비교: 32 == 32.0 == 32" (범위·문자는 제외)
  const inNum = numericVal(inc)
  if (inNum != null) for (const c of candidates) if (numericVal(c) === inNum) return c
  return null
}

// 변형 축(axes) + 들어온 옵션맵(축라벨→ja값)을 받아, 각 축값을 후보로 해결한 선택맵을 만든다.
// resolve 실패한 축은 빠진다(부분 선택). 호출측에서 resolveVariant에 넣으면 SKU 확정.
export function mapIncomingToAxisSel(
  axes: { label: string; values: string[] }[],
  incoming: Record<string, string>,
): { sel: Record<string, string>; unresolved: string[] } {
  const sel: Record<string, string> = {}
  const unresolved: string[] = []
  for (const ax of axes) {
    const raw = incoming[ax.label]
    if (!raw) continue
    const hit = matchAxisValue(raw, ax.values)
    if (hit) sel[ax.label] = hit
    else unresolved.push(`${ax.label}=${raw}`)
  }
  return { sel, unresolved }
}
