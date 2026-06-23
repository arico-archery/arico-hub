import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fetchShop, parseItem } from '@/lib/aricoShop'

export const maxDuration = 30

// POST /api/arico-catalog/[id]/refresh — 그 상품 1건을 자사숍에서 다시 가져와 갱신.
// 크롤 상품(자사숍 url 보유)만 대상. 이름·판매가·포인트·이미지·희망가 갱신.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cat = await prisma.aricoCatalog.findUnique({ where: { id: Number(id) }, select: { url: true, productCode: true } })
  if (!cat) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!cat.url) return NextResponse.json({ error: 'no_url', message: '자사숍 URL이 없는 상품입니다(수동/이벤트 상품).' }, { status: 400 })

  let html: string
  try { html = await fetchShop(cat.url) }
  catch (e) { return NextResponse.json({ error: 'fetch_failed', message: String(e) }, { status: 502 }) }

  const item = parseItem(html, cat.productCode)
  if (!item || !item.name) return NextResponse.json({ error: 'parse_failed', message: '상품 정보를 읽지 못했습니다(페이지 삭제/변경?).' }, { status: 422 })

  const updated = await prisma.aricoCatalog.update({
    where: { id: Number(id) },
    data: {
      name: item.name, priceJpy: item.priceJpy,
      priceJpyNotax: item.priceJpy ? Math.round(item.priceJpy / 1.1) : 0,
      msrpJpy: item.msrpJpy, point: item.point,
      ...(item.imageUrl1 ? { imageUrl1: item.imageUrl1 } : {}),
    },
  })
  return NextResponse.json({ ok: true, name: updated.name, priceJpy: updated.priceJpy, point: updated.point })
}
