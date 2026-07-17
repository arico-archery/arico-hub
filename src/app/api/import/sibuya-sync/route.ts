import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import * as cheerio from 'cheerio'

// SHIBUYA(渋谷アーチェリー) 동기화 — crawl_sibuya.py 로직의 Node 포팅.
// 타임아웃 방지를 위해 클라이언트가 단계/배치로 호출:
//   GET  ?phase=list&page=N      → 목록 1페이지 파싱 { items, maxPage }
//   POST ?phase=detail {items}   → 상세페이지에서 希望小売価格 추출 후 upsert { imported, skipped }

const BASE = 'https://www.shibuya-online.com'
const LIST = BASE + '/view/category/all_items'
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.9',
}

const BRAND_KEYWORDS = [
  'SHIBUYA', 'HOYT', 'EASTON', 'MATHEWS', 'WIN&WIN', 'WINWIN', 'PRIME', 'BOWTECH',
  'PSE', 'BEAR ARCHERY', 'SKYLON', 'CARBON EXPRESS', 'GOLD TIP', 'BEITER', 'CARTEL',
  'SPIGARELLI', 'GILLO', 'FIVICS', 'SEBASTIAN FLUTE', 'AAE', 'DOINKER', 'AXCEL',
  'SHREWD', 'B-STINGER', 'VICTORY ARCHERY', 'BLACK EAGLE',
]

function detectBrand(name: string, breadcrumbs: string[]): string {
  for (const bc of breadcrumbs.slice(1)) {
    const up = bc.toUpperCase().replace(/　/g, ' ')
    for (const kw of BRAND_KEYWORDS) if (up.includes(kw)) return bc.trim()
  }
  const nameUp = name.toUpperCase()
  for (const kw of BRAND_KEYWORDS) {
    if (nameUp.includes(kw)) return kw === 'WINWIN' ? 'WIN&WIN' : kw
  }
  return ''
}

async function fetchHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

function firstNum(t: string): number {
  const m = (t || '').match(/[\d,]+/)
  return m ? parseInt(m[0].replace(/,/g, ''), 10) || 0 : 0
}

type ListItem = { code: string; name: string; msrp: number; image: string; url: string }

// ── GET: 목록 페이지 파싱 ──────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Number(searchParams.get('page') ?? '1')
  try {
    const url = page <= 1 ? LIST : `${LIST}?page=${page}`
    const html = await fetchHtml(url)
    const $ = cheerio.load(html)

    const items: ListItem[] = []
    $('ul.item-list li').each((_, li) => {
      const a = $(li).find('p.item-name a').first()
      const href = a.attr('href') || ''
      const m = href.match(/\/view\/item\/(\d+)/)
      if (!m) return
      items.push({
        code: m[1],
        name: a.text().trim(),
        msrp: firstNum($(li).find('p.price').first().text()),
        image: $(li).find('div.item-list-image img').attr('src') || '',
        url: BASE + href.split('?')[0],
      })
    })

    let maxPage = 1
    $(".pager a[href*='page=']").each((_, a) => {
      const mm = ($(a).attr('href') || '').match(/page=(\d+)/)
      if (mm) maxPage = Math.max(maxPage, parseInt(mm[1], 10))
    })

    return NextResponse.json({ items, maxPage })
  } catch (e) {
    return NextResponse.json({ error: String(e), items: [], maxPage: 1 }, { status: 502 })
  }
}

// ── POST: 상세페이지에서 希望小売価格 추출 후 upsert ──────────────
export async function POST(req: Request) {
  const { items } = await req.json() as { items: ListItem[] }
  if (!items?.length) return NextResponse.json({ imported: 0, skipped: 0 })

  let imported = 0
  let skipped = 0

  const results = await Promise.allSettled(items.map(async (it) => {
    const html = await fetchHtml(`${BASE}/view/item/${it.code}`)
    const $ = cheerio.load(html)
    const text = $.root().text()

    let availability = 'in_stock'
    if (/売り切れ|SOLDOUT/i.test(text)) availability = 'out_of_stock'
    else if (/取寄せ/.test(text)) availability = 'order_only'

    const breadcrumbs = $('.breadcrumb a, ol.breadcrumb li a, nav .breadcrumb a')
      .map((_, a) => $(a).text().trim()).get()
    const category = breadcrumbs[0] || ''

    // 希望小売価格(.fixed-price) → 없으면 목록 가격 fallback
    let fixed = 0
    const nums = ($('.fixed-price').first().text().match(/[\d,]+/g) || [])
    for (const n of nums) { const v = parseInt(n.replace(/,/g, ''), 10); if (v > 0) { fixed = v; break } }
    const cost = fixed || it.msrp
    if (!cost) return 'skip'

    await prisma.product.upsert({
      where: { supplierCode_productCode: { supplierCode: 'SHIBUYA', productCode: it.code } },
      update: {
        name: it.name, brand: detectBrand(it.name, breadcrumbs), category,
        costPrice: cost, msrp: cost, availability, url: it.url, imageUrl1: it.image, scrapedAt: new Date(),
      },
      create: {
        supplierCode: 'SHIBUYA', productCode: it.code, name: it.name,
        brand: detectBrand(it.name, breadcrumbs), category,
        costPrice: cost, msrp: cost, availability, url: it.url, imageUrl1: it.image, scrapedAt: new Date(),
      },
    })
    return 'ok'
  }))

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value === 'ok') imported++
    else skipped++
  }
  return NextResponse.json({ imported, skipped })
}
