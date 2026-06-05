/**
 * ARICO 카탈로그 → 공급사 상품 자동 매칭
 *
 * 사용법:
 *   node match_catalog.js [--dry-run] [--threshold 0.45] [--supplier FIVICS]
 */

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// ── 브랜드 → 공급사 코드 매핑 ─────────────────────────────────
const BRAND_TO_SUPPLIER = {
  'MK KOREA': 'MK', 'MK': 'MK',
  'FIVICS': 'FIVICS', 'ZEILO': 'FIVICS',
  'ANGEL': 'ANGEL',
  'WJ SPORTS': 'WJ', 'WJ SPORT': 'WJ', 'WJ SPORT COUCH': 'WJ', 'WJ': 'WJ', 'WNS': 'WJ',
  'KOREA ARCHERY': 'KOREA', 'KOREA ARCHERY JET': 'KOREA', 'KOREA SPORTS': 'KOREA', 'KOREA': 'KOREA',
  'SHIBUYA': 'SIBUYA', 'SIBUYA': 'SIBUYA', 'SHIBUYA ARCHERY': 'SIBUYA',
  // JVD
  'HOYT': 'JVD', 'WIN&WIN': 'JVD', 'WIAWIS': 'JVD', 'EASTON': 'JVD',
  'BEITER': 'JVD', 'AAE': 'JVD', 'CARTEL': 'JVD', 'AXCEL': 'JVD',
  'BLACK SHEEP': 'JVD', 'BLACKSHEEP': 'JVD', 'AVALON': 'JVD',
  'RANGE-O-MATIC': 'JVD', 'DOINKER': 'JVD', 'DECUT': 'JVD',
  'SPOT HOGG': 'JVD', 'BOHNING': 'JVD', 'ARICO': 'JVD', 'ARICO STRING': 'JVD',
}

// 이름에서 공급사를 추측하는 키워드 (브랜드 없는 경우)
const NAME_KEYWORDS = [
  ['HOYT', 'JVD'], ['WIN&WIN', 'JVD'], ['WIAWIS', 'JVD'], ['EASTON', 'JVD'],
  ['BEITER', 'JVD'], ['AAE ', 'JVD'], ['CARTEL', 'JVD'], ['AXCEL', 'JVD'],
  ['PSE', 'JVD'], ['MATHEWS', 'JVD'], ['DIAMOND', 'JVD'],
  ['FIVICS', 'FIVICS'], ['ZEILO', 'FIVICS'], ['TENPRO', 'FIVICS'], ['TITAN ', 'FIVICS'],
  ['SHIBUYA', 'SIBUYA'], ['SIBUYA', 'SIBUYA'],
  ['KOREA ARCHERY', 'KOREA'], ['KOREA SPORTS', 'KOREA'],
  ['MK KOREA', 'MK'], ['MK ZX', 'MK'], ['MK XG', 'MK'], ['MK FORGED', 'MK'],
  ['ANGEL', 'ANGEL'],
  ['WJ SPORTS', 'WJ'], ['WNS', 'WJ'],
]

function normalizeStr(s) {
  if (!s) return ''
  // 전각→반각
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  // 괄호 내용 제거
  s = s.replace(/[（(（][^）)）]*[）)）]/g, ' ')
  // 특수문자 → 공백
  s = s.replace(/[-_/,\.&＆・]/g, ' ')
  // 다중 공백
  s = s.replace(/\s+/g, ' ').trim()
  return s.toLowerCase()
}

function getKeywords(name) {
  return new Set(normalizeStr(name).split(' ').filter(w => w.length >= 2))
}

// 브랜드명 제거 후 모델 부분만 반환
const BRAND_PREFIXES = [
  'FIVICS ', 'MK KOREA ', 'MK ', 'ANGEL ', 'WJ SPORTS ', 'WNS ',
  'KOREA ARCHERY ', 'KOREA SPORTS ', 'SHIBUYA ', 'SIBUYA ',
  'HOYT ', 'WIN&WIN ', 'WIAWIS ', 'EASTON ', 'BEITER ', 'AAE ',
  'CARTEL ', 'AXCEL ', 'DOINKER ', 'PSE ', 'AVALON ',
  '【取寄せ商品】', '【一部取寄せ商品】', '【カスタムオーダー】', '【廃版】',
]

function stripBrand(name) {
  let s = (name || '').trim()
  // 태그 제거
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

function similarity(a, b) {
  const na = normalizeStr(a), nb = normalizeStr(b)
  if (!na || !nb) return 0

  // 포함 관계
  if (na.includes(nb) || nb.includes(na)) return 0.80

  // 브랜드 제거 후 모델명으로 비교 (더 정확)
  const ma = normalizeStr(stripBrand(a))
  const mb = normalizeStr(stripBrand(b))

  // 모델 포함 관계
  if (ma && mb && ma.length >= 3 && mb.length >= 3) {
    if (ma.includes(mb) || mb.includes(ma)) return 0.85
  }

  // 키워드 교집합 (브랜드 제거 버전)
  const ka = getKeywords(stripBrand(a) || a)
  const kb = getKeywords(stripBrand(b) || b)
  if (ka.size && kb.size) {
    let common = 0
    for (const w of ka) if (kb.has(w)) common++
    if (common > 0) {
      const kwScore = common / Math.min(ka.size, kb.size)
      return kwScore
    }
  }

  // LCS 기반 (원래 이름)
  const longer = na.length > nb.length ? na : nb
  const shorter = na.length > nb.length ? nb : na
  if (longer.length === 0) return 1.0
  const lcsLen = lcs(longer, shorter)
  return (lcsLen * 2) / (longer.length + shorter.length)
}

function lcs(a, b) {
  // 간단한 공통 부분 문자열 길이
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

function detectSupplier(brand, name) {
  const b = (brand || '').toUpperCase().trim()
  if (BRAND_TO_SUPPLIER[b]) return BRAND_TO_SUPPLIER[b]
  // 부분 매칭
  for (const [key, sup] of Object.entries(BRAND_TO_SUPPLIER)) {
    if (b.includes(key)) return sup
  }
  // 이름 키워드
  const nu = (name || '').toUpperCase()
  for (const [kw, sup] of NAME_KEYWORDS) {
    if (nu.includes(kw)) return sup
  }
  return 'JVD'
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  let threshold = 0.45
  let filterSup = null

  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) threshold = parseFloat(args[i + 1])
    if (args[i] === '--supplier' && args[i + 1]) filterSup = args[i + 1].toUpperCase()
  }

  if (dryRun) console.log('🔍 DRY RUN (저장 생략)')
  console.log(`📊 유사도 임계값: ${threshold}`)
  if (filterSup) console.log(`🔧 공급사 필터: ${filterSup}`)
  console.log()

  // 카탈로그 로드
  const catalogItems = await prisma.aricoCatalog.findMany({
    where: { supplierProductId: null },
    select: { id: true, productCode: true, brand: true, name: true },
  })
  console.log(`매칭 대상 카탈로그: ${catalogItems.length}개`)

  // 공급사별 상품 로드
  const allProducts = await prisma.product.findMany({
    select: { id: true, supplierCode: true, productCode: true, name: true, brand: true },
  })
  const productsBySupplier = {}
  for (const p of allProducts) {
    if (!productsBySupplier[p.supplierCode]) productsBySupplier[p.supplierCode] = []
    productsBySupplier[p.supplierCode].push(p)
  }
  for (const [sup, prods] of Object.entries(productsBySupplier)) {
    console.log(`  ${sup}: ${prods.length}개`)
  }
  console.log()

  // 매칭
  const matchResults = []
  let lowScore = 0, noSupplier = 0

  for (const item of catalogItems) {
    const sup = detectSupplier(item.brand, item.name)
    if (filterSup && sup !== filterSup) continue

    let candidates = productsBySupplier[sup] || []
    if (!candidates.length) { noSupplier++; continue }

    // SIBUYA는 SBY- 쇼핑몰 상품 우선
    if (sup === 'SIBUYA') {
      const shopProds = candidates.filter(p => p.productCode.startsWith('SBY-'))
      if (shopProds.length) candidates = shopProds
    }

    // 1단계: 코드 직접 매칭
    let bestScore = 0, bestProd = null
    const catCode = (item.productCode || '').replace(/^0+/, '')
    if (catCode) {
      for (const p of candidates) {
        const pc = (p.productCode || '').replace(/^0+/, '')
        if (catCode === pc) { bestProd = p; bestScore = 1.0; break }
      }
    }

    // 2단계: 이름 유사도
    if (bestScore < 1.0) {
      for (const p of candidates) {
        const score = similarity(item.name, p.name || '')
        if (score > bestScore) { bestScore = score; bestProd = p }
      }
    }

    if (bestProd && bestScore >= threshold) {
      matchResults.push({
        catId: item.id, catCode: item.productCode, catName: item.name,
        prodId: bestProd.id, prodCode: bestProd.productCode, prodName: bestProd.name,
        supplier: sup, score: bestScore,
      })
    } else {
      lowScore++
    }
  }

  // 공급사별 결과 출력
  const bySup = {}
  for (const r of matchResults) {
    if (!bySup[r.supplier]) bySup[r.supplier] = []
    bySup[r.supplier].push(r)
  }

  for (const [sup, items] of Object.entries(bySup).sort()) {
    console.log(`── ${sup} (${items.length}개) ──────────────`)
    for (const r of items.slice(0, 5)) {
      console.log(`  [${r.score.toFixed(2)}] ${(r.catName||'').slice(0,50)}`)
      console.log(`       → ${(r.prodName||'').slice(0,50)} (${r.prodCode})`)
    }
    if (items.length > 5) console.log(`  ... 외 ${items.length - 5}개`)
    console.log()
  }

  console.log(`✅ 매칭: ${matchResults.length}개 | ⚠️ 낮은 점수: ${lowScore}개 | 🚫 공급사없음: ${noSupplier}개`)

  if (dryRun) { console.log('\n(DRY RUN — 저장 생략)'); return }

  // 저장
  console.log('\n💾 저장 중...')
  let saved = 0
  for (const r of matchResults) {
    await prisma.aricoCatalog.update({
      where: { id: r.catId },
      data: { supplierProductId: r.prodId },
    })
    saved++
    if (saved % 100 === 0) process.stdout.write(`  ${saved}/${matchResults.length}\r`)
  }
  console.log(`\n✅ 저장 완료: ${saved}개`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
