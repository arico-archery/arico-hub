import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { searchProductPage, makeshopConfigured } from '@/lib/makeshop'
import { runSyncProducts } from '@/app/api/makeshop/sync-products/route'

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

  // all=1 → 화면의 [MakeShop 동기화] 버튼과 같은 경로(runSyncProducts)를 그대로 실행.
  // 버튼은 로그인이 필요해 검증하기 어렵기 때문에, 같은 코드로 확인할 수단을 둔다.
  if (url.searchParams.get('all') === '1') {
    const { body, status } = await runSyncProducts()
    return NextResponse.json(body, { status })
  }

  const limit = 200
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const agg = { fetched: 0, created: 0, updated: 0, skipped: 0 }
  // 요청당 1페이지만 처리(타임아웃 확실 방지). 클라이언트가 nextPage로 반복.
  const products = await searchProductPage(page, limit)
  agg.fetched = products.length
  const CONC = 10
  for (let i = 0; i < products.length; i += CONC) {
    await Promise.allSettled(products.slice(i, i + CONC).map(async p => {
      const code = String(p.systemCode ?? '').trim()
      if (!code) { agg.skipped++; return }
      const name = String(p.productName ?? '').trim()
      const priceJpy = Math.round(Number(p.sellPrice) || 0)
      const active = p.display === 'Y'   // 자사몰 진열 여부 (N=미진열=판매안함)
      const barcode = String(p.janCode ?? '').trim()   // = 스마레지 productCode (연결 키)
      try {
        const r = await prisma.aricoCatalog.upsert({ where: { productCode: code }, update: { name, priceJpy, active, barcode }, create: { productCode: code, name, priceJpy, active, barcode }, select: { createdAt: true, updatedAt: true } })
        if (r.createdAt.getTime() === r.updatedAt.getTime()) agg.created++; else agg.updated++
      } catch { agg.skipped++ }
    }))
  }
  const done = products.length < limit
  return NextResponse.json({ ok: true, done, ...(done ? {} : { nextPage: page + 1 }), ...agg })
}
