import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { searchProductPage, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 MakeShop 商品 → AricoCatalog 동기화(운영자용). HMAC(AUTH_SECRET) 보호.
// 페이지 청크 + 병렬 upsert + 시간예산(약 48초). 남으면 nextPage 반환.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const limit = 300
  let page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const existing = new Set((await prisma.aricoCatalog.findMany({ select: { productCode: true } })).map(r => r.productCode))
  const agg = { fetched: 0, created: 0, updated: 0, skipped: 0 }
  const t0 = Date.now()
  while (true) {
    const products = await searchProductPage(page, limit)
    agg.fetched += products.length
    const CONC = 10
    for (let i = 0; i < products.length; i += CONC) {
      await Promise.allSettled(products.slice(i, i + CONC).map(p => {
        const code = String(p.systemCode ?? '').trim()
        if (!code) { agg.skipped++; return Promise.resolve() }
        const name = String(p.productName ?? '').trim()
        const priceJpy = Math.round(Number(p.sellPrice) || 0)
        const isNew = !existing.has(code)
        return prisma.aricoCatalog.upsert({ where: { productCode: code }, update: { name, priceJpy }, create: { productCode: code, name, priceJpy } })
          .then(() => { if (isNew) { agg.created++; existing.add(code) } else agg.updated++ })
          .catch(() => { agg.skipped++ })
      }))
    }
    if (products.length < limit) return NextResponse.json({ ok: true, done: true, ...agg })
    page++
    if (Date.now() - t0 > 48000) return NextResponse.json({ ok: true, done: false, nextPage: page, ...agg })
  }
}
