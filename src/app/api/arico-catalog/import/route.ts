import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchShop, codesFromList, listPageUrl, itemUrl, parseItem } from '@/lib/aricoShop'

export const maxDuration = 60

// POST /api/arico-catalog/import — 자사숍에서 "새 상품"만 가져와 카탈로그에 추가.
// body: { pages?: number, maxNew?: number } — 최근 목록 N페이지를 훑어 카탈로그에 없는 코드만 추가.
// ⚠️ 시간 소요 작업. 한 번에 과하게 돌지 않도록 페이지·추가 수를 제한한다.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { pages?: number; maxNew?: number }
  const pages = Math.min(Math.max(1, body.pages ?? 6), 12)   // 최대 12페이지
  const maxNew = Math.min(Math.max(1, body.maxNew ?? 30), 50) // 한 번에 최대 50개 추가

  // 1) 목록 페이지에서 코드 열거
  const shopCodes: string[] = []
  for (let pg = 1; pg <= pages; pg++) {
    try {
      const html = await fetchShop(listPageUrl(pg))
      for (const c of codesFromList(html)) if (!shopCodes.includes(c)) shopCodes.push(c)
    } catch { /* 페이지 실패 무시 */ }
  }

  // 2) 카탈로그에 없는 신규 코드만
  const existing = await prisma.aricoCatalog.findMany({ select: { productCode: true } })
  const have = new Set(existing.map(e => e.productCode))
  const newCodes = shopCodes.filter(c => !have.has(c)).slice(0, maxNew)

  // 3) 신규 상품 상세 파싱 후 추가
  let added = 0
  const samples: string[] = []
  for (const code of newCodes) {
    try {
      const html = await fetchShop(itemUrl(code))
      const item = parseItem(html, code)
      if (!item) continue
      await prisma.aricoCatalog.create({
        data: {
          productCode: code, name: item.name, priceJpy: item.priceJpy,
          priceJpyNotax: item.priceJpy ? Math.round(item.priceJpy / 1.1) : 0,
          msrpJpy: item.msrpJpy, point: item.point, imageUrl1: item.imageUrl1, url: item.url,
        },
      })
      added++
      if (samples.length < 5) samples.push(item.name)
    } catch { /* 개별 실패 무시 */ }
  }

  return NextResponse.json({
    ok: true, scannedPages: pages, shopCodesSeen: shopCodes.length,
    newFound: shopCodes.filter(c => !have.has(c)).length, added, samples,
    truncated: shopCodes.filter(c => !have.has(c)).length > maxNew,
  })
}
