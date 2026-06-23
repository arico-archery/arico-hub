import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchShop, codesFromList, listPageUrl, itemUrl, parseItem } from '@/lib/aricoShop'

export const maxDuration = 60

// POST /api/arico-catalog/import — 자사숍 목록 "한 페이지"만 처리(배치). 클라이언트가 page를 1씩 올려 반복.
// body: { mode: 'new' | 'all', page: number }
//   - new: 카탈로그에 없는 상품만 추가 (기존은 스킵 → 빠름)
//   - all: 모든 상품을 가져와 추가/갱신(upsert) → 느림(전체)
// ⚠️ 한 번에 전체를 돌리지 않도록 페이지 단위로 끊는다.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { mode?: 'new' | 'all'; page?: number }
  const mode = body.mode === 'all' ? 'all' : 'new'
  const page = Math.max(1, body.page ?? 1)

  let codes: string[] = []
  try {
    const html = await fetchShop(listPageUrl(page))
    codes = codesFromList(html)
  } catch {
    return NextResponse.json({ ok: false, page, error: 'list_fetch_failed', hasMore: false })
  }
  if (codes.length === 0) {
    return NextResponse.json({ ok: true, page, seen: 0, added: 0, updated: 0, hasMore: false })
  }

  const existing = await prisma.aricoCatalog.findMany({ where: { productCode: { in: codes } }, select: { productCode: true } })
  const have = new Set(existing.map(e => e.productCode))

  let added = 0, updated = 0
  for (const code of codes) {
    const exists = have.has(code)
    if (mode === 'new' && exists) continue
    try {
      const html = await fetchShop(itemUrl(code))
      const item = parseItem(html, code)
      if (!item) continue
      const data = {
        name: item.name, priceJpy: item.priceJpy,
        priceJpyNotax: item.priceJpy ? Math.round(item.priceJpy / 1.1) : 0,
        msrpJpy: item.msrpJpy, point: item.point, url: item.url,
        ...(item.imageUrl1 ? { imageUrl1: item.imageUrl1 } : {}),
      }
      if (exists) { await prisma.aricoCatalog.update({ where: { productCode: code }, data }); updated++ }
      else { await prisma.aricoCatalog.create({ data: { productCode: code, ...data } }); added++ }
    } catch { /* 개별 실패 무시 */ }
  }

  // 12개 미만이면 마지막 페이지로 간주
  return NextResponse.json({ ok: true, page, seen: codes.length, added, updated, hasMore: codes.length >= 12 })
}
