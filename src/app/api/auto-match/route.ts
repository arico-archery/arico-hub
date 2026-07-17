/**
 * POST /api/auto-match
 * ARICO 카탈로그 ↔ 공급사 상품 자동 매칭
 * JVD 품목은 카타카나 → 영어 변환 후 매칭
 *
 * Body: { dryRun?: boolean, threshold?: number, supplier?: string }
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { calcCostJpy } from '@/lib/utils'

// ── 브랜드 → 공급사 코드 매핑 ─────────────────────────────────
const BRAND_TO_SUPPLIER: Record<string, string> = {
  // 영어 표기
  'MK KOREA': 'MK', 'MK': 'MK',
  'FIVICS': 'FIVICS', 'ZEILO': 'FIVICS',
  'ANGEL': 'ANGEL',
  'WJ SPORTS': 'WJ', 'WJ SPORT': 'WJ', 'WJ': 'WJ', 'WNS': 'WJ',
  'KOREA ARCHERY': 'KOREA', 'KOREA ARCHERY JET': 'KOREA', 'KOREA SPORTS': 'KOREA', 'KOREA': 'KOREA',
  // 브랜드 표기는 SHIBUYA/SIBUYA 둘 다 들어온다 → 공급사 코드 SHIBUYA로 모은다
  'SHIBUYA': 'SHIBUYA', 'SIBUYA': 'SHIBUYA', 'SHIBUYA ARCHERY': 'SHIBUYA',
  'HOYT': 'JVD', 'WIN&WIN': 'JVD', 'WIAWIS': 'JVD', 'EASTON': 'JVD',
  'BEITER': 'JVD', 'AAE': 'JVD', 'CARTEL': 'JVD', 'AXCEL': 'JVD',
  'BLACK SHEEP': 'JVD', 'BLACKSHEEP': 'JVD', 'AVALON': 'JVD',
  'RANGE-O-MATIC': 'JVD', 'DOINKER': 'JVD', 'DECUT': 'JVD',
  'SPOT HOGG': 'JVD', 'BOHNING': 'JVD', 'ARICO': 'JVD', 'ARICO STRING': 'JVD',
  'PSE': 'JVD', 'MATHEWS': 'JVD', 'GOLD TIP': 'JVD', 'GOLDTIP': 'JVD',
  // カタカナ表記 → JVD
  'ホイット': 'JVD', 'イーストン': 'JVD', 'ウィアウィス': 'JVD',
  'ウィン&ウィン': 'JVD', 'ウィン＆ウィン': 'JVD',
  'バイター': 'JVD', 'ベイター': 'JVD',
  'アクセル': 'JVD', 'カーテル': 'JVD', 'ドインカー': 'JVD',
  'アバロン': 'JVD', 'デカット': 'JVD', 'ボーニング': 'JVD',
  'ブラックシープ': 'JVD', 'スポットホッグ': 'JVD',
  'ゴールドチップ': 'JVD', 'ゴールドティップ': 'JVD',
}

const NAME_KEYWORDS: [string, string][] = [
  // 영어
  ['HOYT', 'JVD'], ['WIN&WIN', 'JVD'], ['WIAWIS', 'JVD'], ['EASTON', 'JVD'],
  ['BEITER', 'JVD'], ['AAE ', 'JVD'], ['CARTEL', 'JVD'], ['AXCEL', 'JVD'],
  ['PSE', 'JVD'], ['MATHEWS', 'JVD'], ['GOLD TIP', 'JVD'], ['DOINKER', 'JVD'],
  ['FIVICS', 'FIVICS'], ['ZEILO', 'FIVICS'], ['TENPRO', 'FIVICS'], ['TITAN ', 'FIVICS'],
  ['SHIBUYA', 'SHIBUYA'], ['SIBUYA', 'SHIBUYA'],
  ['KOREA ARCHERY', 'KOREA'], ['KOREA SPORTS', 'KOREA'],
  ['MK KOREA', 'MK'], ['MK ZX', 'MK'], ['MK XG', 'MK'], ['MK FORGED', 'MK'],
  ['ANGEL', 'ANGEL'],
  ['WJ SPORTS', 'WJ'], ['WNS', 'WJ'],
  // カタカナ → JVD
  ['ホイット', 'JVD'], ['イーストン', 'JVD'], ['ウィアウィス', 'JVD'],
  ['ウィン&ウィン', 'JVD'], ['バイター', 'JVD'], ['ベイター', 'JVD'],
  ['アクセル', 'JVD'], ['カーテル', 'JVD'], ['ドインカー', 'JVD'],
  ['アバロン', 'JVD'], ['デカット', 'JVD'], ['ボーニング', 'JVD'],
  ['ブラックシープ', 'JVD'], ['スポットホッグ', 'JVD'],
]

const BRAND_PREFIXES = [
  // 英語
  'FIVICS ', 'MK KOREA ', 'MK ', 'ANGEL ', 'WJ SPORTS ', 'WNS ',
  'KOREA ARCHERY ', 'KOREA SPORTS ', 'SHIBUYA ', 'SIBUYA ',
  'HOYT ', 'WIN&WIN ', 'WIAWIS ', 'EASTON ', 'BEITER ', 'AAE ',
  'CARTEL ', 'AXCEL ', 'DOINKER ', 'PSE ', 'AVALON ',
  // カタカナ
  'ホイット ', 'イーストン ', 'ウィアウィス ', 'ウィン&ウィン ',
  'バイター ', 'ベイター ', 'アクセル ', 'カーテル ', 'ドインカー ',
  'アバロン ', 'デカット ', 'ボーニング ', 'ブラックシープ ',
  'スポットホッグ ', 'ゴールドチップ ',
  // 日本語注記
  '【取寄せ商品】', '【一部取寄せ商品】', '【カスタムオーダー】', '【廃版】',
]

// ── カタカナ/漢字 → 英語 変換辞書 (JVD マッチング用) ─────────
const JA_TO_EN: [RegExp, string][] = [
  // ブランド名
  [/ホイット/g, 'HOYT'],
  [/イーストン/g, 'EASTON'],
  [/ウィアウィス/g, 'WIAWIS'],
  [/ウィン[&＆]ウィン|ウィンアンドウィン/g, 'WIN WIN'],
  [/バイター|ベイター/g, 'BEITER'],
  [/アクセル/g, 'AXCEL'],
  [/カーテル/g, 'CARTEL'],
  [/ドインカー/g, 'DOINKER'],
  [/アバロン/g, 'AVALON'],
  [/デカット/g, 'DECUT'],
  [/ボーニング/g, 'BOHNING'],
  [/ブラックシープ/g, 'BLACK SHEEP'],
  [/スポット ?ホッグ/g, 'SPOT HOGG'],
  [/ゴールドチップ|ゴールドティップ/g, 'GOLD TIP'],
  [/レンジ.?オ.?マティック/g, 'RANGE O MATIC'],
  // 弓具 — 本体
  [/ハンドル/g, 'RISER'],
  [/リカーブ/g, 'RECURVE'],
  [/コンパウンド/g, 'COMPOUND'],
  [/クロスボウ/g, 'CROSSBOW'],
  [/リム\b/g, 'LIMB'],
  [/ボウ\b/g, 'BOW'],
  [/ストリング/g, 'STRING'],
  [/ケーブル/g, 'CABLE'],
  // サイト・照準
  [/サイト/g, 'SIGHT'],
  [/スコープ/g, 'SCOPE'],
  [/ピープ/g, 'PEEP'],
  [/ファイバー/g, 'FIBER'],
  [/ピン\b/g, 'PIN'],
  // スタビライザー関連
  [/スタビライザー/g, 'STABILIZER'],
  [/スタビ\b/g, 'STABILIZER'],
  [/エクステンダー/g, 'EXTENDER'],
  [/ロッド\b/g, 'ROD'],
  [/ダンパー/g, 'DAMPER'],
  [/Vバー|Vバー/g, 'V BAR'],
  // 矢・コンポーネント
  [/シャフト/g, 'SHAFT'],
  [/アロー/g, 'ARROW'],
  [/ノック/g, 'NOCK'],
  [/ポイント\b/g, 'POINT'],
  [/インサート/g, 'INSERT'],
  [/ブッシング/g, 'BUSHING'],
  [/フレッチング/g, 'FLETCHING'],
  [/フレッチ/g, 'FLETCH'],
  [/ベイン|フェザー/g, 'VANE'],
  [/スピン ?ウィング/g, 'SPIN WING'],
  [/ラップ\b/g, 'WRAP'],
  // 引き手・アクセサリ
  [/タブ\b/g, 'TAB'],
  [/グローブ/g, 'GLOVE'],
  [/スリング/g, 'SLING'],
  [/リリーサー?/g, 'RELEASE'],
  [/クリッカー/g, 'CLICKER'],
  [/プランジャー/g, 'PLUNGER'],
  [/ボタン/g, 'BUTTON'],
  // 防具・ウェア
  [/アームガード|アーム ?ガード/g, 'ARM GUARD'],
  [/チェストガード|チェスト ?ガード/g, 'CHEST GUARD'],
  [/フィンガー ?タブ/g, 'FINGER TAB'],
  // ケース・収納
  [/ケース/g, 'CASE'],
  [/バッグ/g, 'BAG'],
  [/クイーバー/g, 'QUIVER'],
  [/バレル/g, 'BARREL'],
  [/ホルダー/g, 'HOLDER'],
  [/ストラップ/g, 'STRAP'],
  // グリップ
  [/グリップ/g, 'GRIP'],
  // 材質
  [/カーボン/g, 'CARBON'],
  [/アルミ(?:ニウム)?/g, 'ALUMINUM'],
  [/マグネシウム/g, 'MAGNESIUM'],
  [/チタン/g, 'TITANIUM'],
  [/スチール/g, 'STEEL'],
  [/ウッド|木製/g, 'WOOD'],
  // 利き手
  [/ライトハンド|右手用|右利き/g, 'RH'],
  [/レフトハンド|左手用|左利き/g, 'LH'],
  // カラー
  [/ブラック/g, 'BLACK'],
  [/シルバー?/g, 'SILVER'],
  [/ホワイト|白/g, 'WHITE'],
  [/レッド|赤/g, 'RED'],
  [/ブルー|青/g, 'BLUE'],
  [/グリーン|緑/g, 'GREEN'],
  [/ゴールド|金/g, 'GOLD'],
  [/パープル|紫/g, 'PURPLE'],
  [/ブロンズ/g, 'BRONZE'],
  [/ガンメタル?|ガンメタ/g, 'GUNMETAL'],
  [/オレンジ/g, 'ORANGE'],
  [/ピンク/g, 'PINK'],
  [/イエロー|黄/g, 'YELLOW'],
  [/グレー|グレイ/g, 'GRAY'],
  // グレード・種別
  [/プロ\b/g, 'PRO'],
  [/エリート/g, 'ELITE'],
  [/スポーツ/g, 'SPORT'],
  [/マスター/g, 'MASTER'],
  [/ジュニア/g, 'JUNIOR'],
  [/カスタム/g, 'CUSTOM'],
  [/スタンダード/g, 'STANDARD'],
  [/クラシック/g, 'CLASSIC'],
  [/プレミアム/g, 'PREMIUM'],
  [/アドバンス(?:ド)?/g, 'ADVANCED'],
  [/ターゲット/g, 'TARGET'],
  [/フィールド/g, 'FIELD'],
  [/インドア/g, 'INDOOR'],
  [/アウトドア/g, 'OUTDOOR'],
  [/ロング/g, 'LONG'],
  [/ショート/g, 'SHORT'],
  [/ミディアム|ミドル/g, 'MEDIUM'],
  [/ウルトラ/g, 'ULTRA'],
  [/スーパー/g, 'SUPER'],
  [/ミニ/g, 'MINI'],
  [/マックス/g, 'MAX'],
  [/プラス/g, 'PLUS'],
  [/フレックス/g, 'FLEX'],
  [/ゼロ/g, 'ZERO'],
  // モデル名
  [/アルファ/g, 'ALPHA'],
  [/フォーミュラ/g, 'FORMULA'],
  [/マトリックス/g, 'MATRIX'],
  [/ビクトリー/g, 'VICTORY'],
  [/エース\b/g, 'ACE'],
  [/フォーカス/g, 'FOCUS'],
  [/インフィニティ/g, 'INFINITY'],
  [/プライム/g, 'PRIME'],
  [/ベクター/g, 'VECTOR'],
  [/セット\b/g, 'SET'],
  [/パーツ/g, 'PARTS'],
  [/キット/g, 'KIT'],
  [/オプション/g, 'OPTION'],
  // 数字
  [/ワン\b/g, '1'],
  [/ツー\b/g, '2'],
  [/スリー\b/g, '3'],
  // 括弧付き記号
  [/[（(]RH[）)]/g, 'RH'],
  [/[（(]LH[）)]/g, 'LH'],
]

/** カタカナ/漢字品名 → 英語 (JVD マッチング用) */
function translateForMatching(name: string): string {
  let s = name
  // 全角→半角 (英数字)
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  // 辞書置換
  for (const [pat, rep] of JA_TO_EN) s = s.replace(pat, rep)
  // 余分なスペース整理
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

// ────────────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  if (!s) return ''
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  s = s.replace(/[（(（][^）)）]*[）)）]/g, ' ')
  s = s.replace(/[-_/,.&＆・]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  return s.toLowerCase()
}

function getKeywords(name: string): Set<string> {
  return new Set(normalizeStr(name).split(' ').filter(w => w.length >= 2))
}

function stripBrand(name: string): string {
  let s = (name || '').trim()
  s = s.replace(/【[^】]*】/g, '').trim()
  const upper = s.toUpperCase()
  for (const pfx of BRAND_PREFIXES) {
    if (upper.startsWith(pfx.toUpperCase())) {
      s = s.slice(pfx.length).trim()
      break
    }
  }
  return s
}

function lcs(a: string, b: string): number {
  let maxLen = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let len = 0
      while (i + len < a.length && j + len < b.length && a[i + len] === b[j + len]) len++
      if (len > maxLen) maxLen = len
    }
  }
  return maxLen
}

// 좌우(LH/RH·左右) 방향 추출 — 양궁에서 좌/우는 완전히 다른 제품이라
// 매칭 시 방향이 어긋나면 절대 안 된다.
function direction(name: string): 'LH' | 'RH' | null {
  const n = name || ''
  const hasLH = /(^|[^A-Za-z])LH([^A-Za-z]|$)/.test(n) || n.includes('左')
  const hasRH = /(^|[^A-Za-z])RH([^A-Za-z]|$)/.test(n) || n.includes('右')
  if (hasLH && !hasRH) return 'LH'
  if (hasRH && !hasLH) return 'RH'
  return null
}

// 이름 전처리 결과 캐시 (상품마다 1회만 계산해 재사용 → 매칭 성능 핵심)
type PP = { norm: string; normStripped: string; keywords: Set<string>; dir: 'LH' | 'RH' | null }

function preprocess(name: string): PP {
  const stripped = stripBrand(name)
  return {
    norm: normalizeStr(name),
    normStripped: normalizeStr(stripped),
    keywords: getKeywords(stripped || name),
    dir: direction(name),
  }
}

function simPP(a: PP, b: PP): number {
  if (!a.norm || !b.norm) return 0
  if (a.norm.includes(b.norm) || b.norm.includes(a.norm)) return 0.80
  if (a.normStripped.length >= 3 && b.normStripped.length >= 3 &&
      (a.normStripped.includes(b.normStripped) || b.normStripped.includes(a.normStripped))) return 0.85
  if (a.keywords.size && b.keywords.size) {
    let common = 0
    for (const w of a.keywords) if (b.keywords.has(w)) common++
    // 키워드가 양쪽 다 있으면 키워드 기반으로 확정.
    // 공통 키워드가 0이면 사실상 다른 상품이므로 무거운 lcs를 생략(성능 핵심).
    return common > 0 ? common / Math.min(a.keywords.size, b.keywords.size) : 0
  }
  // 키워드가 한쪽이라도 없을 때(짧은 이름 등)만 lcs fallback
  const longer = a.norm.length > b.norm.length ? a.norm : b.norm
  const shorter = a.norm.length > b.norm.length ? b.norm : a.norm
  if (longer.length === 0) return 1.0
  return (lcs(longer, shorter) * 2) / (longer.length + shorter.length)
}

/**
 * 카탈로그명(전처리)과 상품명(전처리)을 비교.
 * JVD: 카타카나→영어 변환본(catTransPP)도 비교해 높은 쪽 채택.
 */
function simBest(catPP: PP, catTransPP: PP | null, prodPP: PP): number {
  // 방향 가드: 양쪽 모두 방향이 명시됐는데 서로 다르면 매칭 불가 (LH↔RH 오매칭 차단)
  if (catPP.dir && prodPP.dir && catPP.dir !== prodPP.dir) return 0
  const base = simPP(catPP, prodPP)
  if (!catTransPP) return base
  return Math.max(base, simPP(catTransPP, prodPP))
}

function detectSupplier(brand: string, name: string): string {
  const b = (brand || '').toUpperCase().trim()
  if (BRAND_TO_SUPPLIER[b]) return BRAND_TO_SUPPLIER[b]
  for (const [key, sup] of Object.entries(BRAND_TO_SUPPLIER)) {
    if (b.includes(key) || brand.includes(key)) return sup
  }
  const nu = (name || '').toUpperCase()
  for (const [kw, sup] of NAME_KEYWORDS) {
    if (nu.includes(kw) || name.includes(kw)) return sup
  }
  return 'JVD'
}

// 매칭 시도 공급사 우선순위.
// 주 공급사(JVD 등)를 먼저 시도하고, threshold 미달이면 SHIBUYA로 fallback.
//   - 카탈로그명은 일본어, JVD명은 영어라 번역매칭이 약함.
//   - SHIBUYA는 일본어 종합유통(HOYT/EASTON/BEITER 등 타브랜드도 취급)이라
//     일본어끼리 직접 비교가 더 정확함.
//   - 단 "타브랜드는 JVD 우선" 규칙 — JVD가 threshold를 넘으면 그대로 JVD 채택.
function detectSuppliers(brand: string, name: string): string[] {
  const primary = detectSupplier(brand, name)
  if (primary === 'SHIBUYA') return ['SHIBUYA']
  return [primary, 'SHIBUYA']
}

type Product = { id: number; supplierCode: string; productCode: string; name: string; brand: string; costPrice: number; pp: PP }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const dryRun: boolean = body.dryRun ?? false
  const threshold: number = body.threshold ?? 0.45
  const filterSup: string | null = body.supplier?.toUpperCase() ?? null

  // 미매칭 카탈로그만 대상
  const catalogItems = await prisma.aricoCatalog.findMany({
    where: { supplierProductId: null },
    select: { id: true, productCode: true, brand: true, name: true, priceJpy: true },
  })

  // 공급사별 상품 로드 (이름 전처리를 상품마다 1회만 계산해 캐싱)
  const allProducts = await prisma.product.findMany({
    select: { id: true, supplierCode: true, productCode: true, name: true, brand: true, costPrice: true },
  })
  const productsBySupplier: Record<string, Product[]> = {}
  for (const raw of allProducts) {
    const p: Product = { ...raw, pp: preprocess(raw.name || '') }
    if (!productsBySupplier[p.supplierCode]) productsBySupplier[p.supplierCode] = []
    productsBySupplier[p.supplierCode].push(p)
  }

  // 원가 비교용: 공급사 정보 + 환율 로드
  const suppliers = await prisma.supplier.findMany({
    select: { code: true, currency: true, taxRate: true, discount: true },
  })
  const supplierMap: Record<string, { currency: string; taxRate: number; discount: number }> = {}
  for (const s of suppliers) {
    supplierMap[s.code] = { currency: s.currency, taxRate: s.taxRate, discount: s.discount }
  }
  const rateRows = await prisma.exchangeRate.findMany({ select: { currency: true, rateToJpy: true } })
  const rates = rateRows.map(r => ({ currency: r.currency, rateToJpy: r.rateToJpy }))

  // 매칭된 상품의 JPY 환산 원가 계산 (공급사 비교용)
  const costOf = (p: Product): number => {
    const sup = supplierMap[p.supplierCode]
    if (!sup) return 0
    return calcCostJpy(
      { costPrice: p.costPrice, brand: p.brand, supplierCode: p.supplierCode, name: p.name, supplier: sup },
      rates,
    )
  }

  type MatchResult = {
    catId: number; catCode: string; catName: string; catPriceJpy: number
    prodId: number; prodCode: string; prodName: string
    supplier: string; score: number; costJpy: number; translated?: string
  }
  const matchResults: MatchResult[] = []
  let lowScore = 0
  let noSupplier = 0

  for (const item of catalogItems) {
    // 주 공급사 우선, 미달 시 SHIBUYA fallback (JVD 우선 규칙 유지)
    let supList = detectSuppliers(item.brand, item.name)
    if (filterSup) {
      if (!supList.includes(filterSup)) continue
      supList = [filterSup]
    }

    const catCode = (item.productCode || '').replace(/^0+/, '')
    // 카탈로그명 전처리는 item당 1회만 (JVD용 카타카나→영어 변환본도 1회)
    const catPP = preprocess(item.name || '')
    const catTransPP = preprocess(translateForMatching(item.name || ''))
    // 각 후보 공급처에서 threshold를 넘는 best 매칭을 모두 수집
    const hits: { prod: Product; score: number; sup: string; isJvd: boolean; costJpy: number }[] = []
    let anyCandidates = false

    for (const sup of supList) {
      let candidates = productsBySupplier[sup] ?? []
      if (!candidates.length) continue
      anyCandidates = true

      const isJvd = sup === 'JVD'

      // SHIBUYA는 SBY- 쇼핑몰 상품 우선
      if (sup === 'SHIBUYA') {
        const shopProds = candidates.filter(p => p.productCode.startsWith('SBY-'))
        if (shopProds.length) candidates = shopProds
      }

      // 1단계: 코드 직접 매칭
      let bestScore = 0
      let bestProd: Product | null = null
      if (catCode) {
        for (const p of candidates) {
          const pc = (p.productCode || '').replace(/^0+/, '')
          if (catCode === pc) { bestProd = p; bestScore = 1.0; break }
        }
      }

      // 2단계: 이름 유사도 (JVD는 카타카나→영어 변환 포함, 전처리 캐시 사용)
      if (bestScore < 1.0) {
        for (const p of candidates) {
          const score = simBest(catPP, isJvd ? catTransPP : null, p.pp)
          if (score > bestScore) { bestScore = score; bestProd = p }
        }
      }

      if (bestProd && bestScore >= threshold) {
        hits.push({ prod: bestProd, score: bestScore, sup, isJvd, costJpy: costOf(bestProd) })
      }
    }

    // 중복 매칭(JVD ∩ SHIBUYA 등) 시 원가가 더 싼 공급처 선택.
    // 원가 동점이거나 한쪽 원가를 못 구하면 supList 순서(JVD 우선) 유지.
    let chosen: typeof hits[number] | null = null
    for (const h of hits) {
      if (!chosen) { chosen = h; continue }
      const a = h.costJpy, b = chosen.costJpy
      // 유효한(>0) 원가끼리만 비교해 더 싼 쪽 채택
      if (a > 0 && (b <= 0 || a < b)) chosen = h
    }

    if (chosen) {
      matchResults.push({
        catId: item.id, catCode: item.productCode, catName: item.name, catPriceJpy: item.priceJpy,
        prodId: chosen.prod.id, prodCode: chosen.prod.productCode, prodName: chosen.prod.name,
        supplier: chosen.sup, score: chosen.score, costJpy: chosen.costJpy,
        // JVD의 경우 변환된 이름도 preview에 표시
        ...(chosen.isJvd ? { translated: translateForMatching(item.name) } : {}),
      })
    } else if (!anyCandidates) {
      noSupplier++
    } else {
      lowScore++
    }
  }

  // 저장
  let saved = 0
  let priceApplied = 0
  if (!dryRun) {
    for (const r of matchResults) {
      // 미매칭(supplierProductId=null)인 경우에만 저장 → 수작업 매칭 보호.
      // catalogItems를 미매칭만 가져오지만, 그 사이 수작업 매칭이 들어와도
      // 덮어쓰지 않도록 저장 조건으로 한 번 더 방어한다.
      const upd = await prisma.aricoCatalog.updateMany({
        where: { id: r.catId, supplierProductId: null },
        data: { supplierProductId: r.prodId },
      })
      if (upd.count === 0) continue  // 이미 매칭됨 → 건너뜀 (덮어쓰기 금지)
      // 카탈로그 판매가를 공급사 상품 salePriceJpy에 자동 반영
      if (r.catPriceJpy > 0) {
        await prisma.product.update({
          where: { id: r.prodId },
          data: { salePriceJpy: r.catPriceJpy },
        })
        priceApplied++
      }
      saved++
    }
  }

  // 공급사별 요약
  const bySup: Record<string, number> = {}
  for (const r of matchResults) {
    bySup[r.supplier] = (bySup[r.supplier] ?? 0) + 1
  }

  return NextResponse.json({
    matched: matchResults.length,
    saved: dryRun ? 0 : saved,
    priceApplied: dryRun ? 0 : priceApplied,
    lowScore,
    noSupplier,
    total: catalogItems.length,
    bySup,
    dryRun,
    preview: matchResults.slice(0, 20).map(r => ({
      catName: r.catName,
      translated: r.translated,   // JVD 변환명 표시
      prodName: r.prodName,
      supplier: r.supplier,
      score: r.score,
    })),
  })
}
