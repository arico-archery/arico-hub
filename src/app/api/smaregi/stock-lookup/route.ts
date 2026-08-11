import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extractOptionCode } from '@/lib/smaregi-option'

// POST /api/smaregi/stock-lookup
//   body: { lines: [{ key, productId?, code?, name?, options?: string[] }] }
//   → { stock: { [key]: { total, tokyo, aichi, skus, via } } }
//
// 주문 화면에서 라인별 매장 재고(스마레지)를 보여준다. 연결 경로 3단계:
//   ① 옵션코드(=스마레지 상품코드 13자리)가 있으면 그대로
//   ② 상품/카탈로그 바코드(JAN) → 스마레지 상품코드   ※바코드 보유가 적어 대부분 실패
//   ③ 이름 매칭 — 스마레지 이름 끝의 옵션값(size/color)을 떼어낸 베이스명이
//      카탈로그(또는 상품)명으로 시작하면 같은 상품군. 선택된 옵션이 있으면 그 SKU만,
//      없으면 상품군 전체 합계를 보여준다.
//      (예: 카탈로그 "FIVICS SAKER1 タブ" ↔ 스마레지 "FIVICS SAKER 1 タブ RH L")

type SmRow = { productCode: string; name: string; size: string; color: string; stock: number; stockTokyo: number; stockAichi: number }
type Cache = { at: number; byCode: Map<string, SmRow>; byBase: Map<string, SmRow[]> }
let cache: Cache | null = null
const TTL_MS = 5 * 60 * 1000   // 스마레지 동기화 캐시 테이블이라 5분이면 충분

const norm = (s: string) => String(s || '').normalize('NFKC').replace(/[【】\[\]()（）]/g, '').replace(/[\s　]/g, '').toLowerCase()
// 스마레지 이름 끝에 붙는 옵션값(size·color)을 떼어 베이스명을 얻는다.
// 문자열 전체에서 지우면 "L" 같은 한 글자가 이름 속 글자까지 지우므로 끝에서만 벗긴다.
function baseOf(r: SmRow): string {
  let n = norm(r.name)
  for (const v of [r.color, r.size]) {
    const t = norm(v)
    if (t && n.endsWith(t)) n = n.slice(0, -t.length)
  }
  return n
}
// FIVICS 변형 축 표기 → 스마레지 옵션값 (LEFT HANDED - LARGE → LH, L)
const AXIS_MAP: [RegExp, string][] = [
  [/left\s*handed/i, 'lh'], [/right\s*handed/i, 'rh'],
  [/extra\s*large/i, 'xl'], [/extra\s*small/i, 'xs'],
  [/large/i, 'l'], [/medium/i, 'm'], [/small/i, 's'],
]
function optTokens(values: string[]): string[] {
  const out: string[] = []
  for (const v of values) {
    const raw = String(v || '')
    if (!raw) continue
    let hit = false
    for (const [re, tok] of AXIS_MAP) if (re.test(raw)) { out.push(tok); hit = true }
    if (!hit) out.push(norm(raw))
  }
  return [...new Set(out.filter(Boolean))]
}

async function getCache(): Promise<Cache> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache
  const rows = await prisma.smaregiProduct.findMany({
    select: { productCode: true, name: true, size: true, color: true, stock: true, stockTokyo: true, stockAichi: true },
  })
  const byCode = new Map<string, SmRow>()
  const byBase = new Map<string, SmRow[]>()
  for (const r of rows) {
    if (r.productCode) byCode.set(r.productCode, r)
    const b = baseOf(r)
    if (b.length >= 4) {
      if (!byBase.has(b)) byBase.set(b, [])
      byBase.get(b)!.push(r)
    }
  }
  cache = { at: Date.now(), byCode, byBase }
  return cache
}

type Line = { key: string; productId?: number; code?: string; name?: string; options?: string[] }
type Qty = { total: number; tokyo: number; aichi: number; skus: number; via: string }

export async function POST(req: Request) {
  const body = await req.json() as { lines?: Line[] }
  const lines = (body.lines ?? []).slice(0, 100)
  const stock: Record<string, Qty> = {}
  if (!lines.length) return NextResponse.json({ stock })

  try {
    const c = await getCache()
    // 상품 id → 바코드 (상품 자체 + 매칭된 카탈로그)
    const ids = [...new Set(lines.map(l => l.productId).filter((v): v is number => !!v))]
    const barcodeOf = new Map<number, string>()
    if (ids.length) {
      const [prods, cats] = await Promise.all([
        prisma.product.findMany({ where: { id: { in: ids }, NOT: { barcode: '' } }, select: { id: true, barcode: true } }),
        prisma.aricoCatalog.findMany({ where: { supplierProductId: { in: ids }, NOT: { barcode: '' } }, select: { supplierProductId: true, barcode: true } }),
      ])
      for (const p of prods) barcodeOf.set(p.id, p.barcode)
      for (const x of cats) if (x.supplierProductId != null && !barcodeOf.has(x.supplierProductId)) barcodeOf.set(x.supplierProductId, x.barcode)
    }

    const sum = (rows: SmRow[], via: string): Qty => ({
      total: rows.reduce((s, r) => s + r.stock, 0),
      tokyo: rows.reduce((s, r) => s + r.stockTokyo, 0),
      aichi: rows.reduce((s, r) => s + r.stockAichi, 0),
      skus: rows.length, via,
    })

    for (const l of lines) {
      // ① 옵션코드
      const code = extractOptionCode(l.code)
      if (code) { const r = c.byCode.get(code); if (r) { stock[l.key] = sum([r], 'code'); continue } }
      // ② 바코드
      const bc = l.productId ? barcodeOf.get(l.productId) : undefined
      if (bc) { const r = c.byCode.get(bc); if (r) { stock[l.key] = sum([r], 'barcode'); continue } }
      // ③ 이름 + 옵션
      const base = norm(l.name ?? '')
      if (base.length < 4) continue
      let rows: SmRow[] = c.byBase.get(base) ?? []
      if (!rows.length) {
        // 베이스명이 조금 더 긴 SKU 군(색·규격이 이름에 붙은 것)도 같은 상품으로 본다
        for (const [b, rs] of c.byBase) if (b.startsWith(base)) rows = rows.concat(rs)
      }
      if (!rows.length) continue
      const toks = optTokens(l.options ?? [])
      if (toks.length) {
        const picked = rows.filter(r => {
          const sc = [norm(r.size), norm(r.color)]
          return toks.every(t => sc.includes(t))
        })
        if (picked.length) { stock[l.key] = sum(picked, 'name+opt'); continue }
      }
      stock[l.key] = sum(rows, 'name')
    }
    return NextResponse.json({ stock })
  } catch (e) {
    console.error('stock-lookup error:', e)
    return NextResponse.json({ stock })
  }
}
