// 옵션 표준어 사전 (ja ↔ en) + 변형 자동 해결.
// 들어온 주문 옵션(일본어, 예: グラファイトブラック)을 공급사 변형 축값(영어, 예: Graphite Black)에
// 매핑해 정확한 SKU를 결정론적으로 찾는다. (MakeShop 주문 자동유입 시 사용)
//
// 사전은 점진 확장한다. 매칭 우선순위: ①정규화 완전일치 ②사전(ja→en) ③en 정규화 일치.
// 새 색상이 나오면 COLOR_JA_EN에 한 줄 추가하면 된다.

// WIAWIS 등 양궁 핸들 색상 (카타카나 → 영어). 데이터에서 확인된 페어.
export const COLOR_JA_EN: Record<string, string> = {
  'グラファイトブラック': 'Graphite Black',
  'ブラック/ゴールド': 'Black/Gold',
  'ブラック/レッド': 'Black/Red',
  'バーガンディレッド': 'Burgandy Red',
  'ヒートブルー': 'Heat Blue',
  'インディゴブルー': 'Indigo Blue',
  'メタリックシルバー': 'Metallic Silver',
  'ブリリアントシルバー': 'Brilliant Silver',
  'ミスティックバイオレット': 'Mystic Violet',
  'レーシングカーキ': 'Racing Khaki',
  'ソニックレッド': 'Sonic Red',
  'ストーンベージュ': 'Stone Beige',
  'ストーンミント': 'Stone Mint',
  'サンオレンジ': 'Sun Orange',
  'ターキーグリーン': 'Turkey Green',
  'ホワイト': 'White',
  'ブラック': 'Black',
}

// 방향(左右) 정규화. 두 데이터셋 모두 RH/LH를 쓰지만, 일본어 표기 변형도 흡수.
export function normalizeDirection(v: string): string {
  const s = (v || '').trim()
  if (/(^|[^A-Za-z])RH([^A-Za-z]|$)|右/i.test(s) || /^R$/i.test(s)) return 'RH'
  if (/(^|[^A-Za-z])LH([^A-Za-z]|$)|左/i.test(s) || /^L$/i.test(s)) return 'LH'
  return s
}

// 비교용 정규화: 소문자 + 공백/구두점 제거
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[\s/\-_.]/g, '')
}

// 들어온 옵션값(주로 ja)을 후보 축값들(공급사 표기, 주로 en) 중 하나로 해결. 못 찾으면 null.
export function matchAxisValue(incoming: string, candidates: string[]): string | null {
  const inc = (incoming || '').trim()
  if (!inc) return null
  // ① 정규화 완전일치
  const ninc = norm(inc)
  for (const c of candidates) if (norm(c) === ninc) return c
  // ② 사전(ja→en)
  const en = COLOR_JA_EN[inc]
  if (en) {
    const nen = norm(en)
    for (const c of candidates) if (norm(c) === nen) return c
  }
  // ③ 방향 정규화 후 일치
  const nd = norm(normalizeDirection(inc))
  for (const c of candidates) if (norm(normalizeDirection(c)) === nd) return c
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
