import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { smaregiConfigured, SmaregiError } from '@/lib/smaregi'
import { syncProductsPage, syncStockPage, resetStock } from '@/lib/smaregi-sync'

export const maxDuration = 60

// 로그인 없이 스마레지 상품·재고 → SmaregiProduct 캐시 동기화(운영자용). HMAC 보호.
// 2단계: phase=products(상품 upsert) → phase=stock(재고 합산). 요청당 1페이지.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!smaregiConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const phase = url.searchParams.get('phase') === 'stock' ? 'stock' : 'products'
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)

  try {
    if (phase === 'products') {
      const { count, done } = await syncProductsPage(page)
      if (done) await resetStock()   // 상품 끝 → 재고 합산 전 초기화
      return NextResponse.json({ ok: true, phase, page, count, next: done ? { phase: 'stock', page: 1 } : { phase: 'products', page: page + 1 } })
    } else {
      const { count, done } = await syncStockPage(page)
      return NextResponse.json({ ok: true, phase, page, count, done, ...(done ? {} : { next: { phase: 'stock', page: page + 1 } }) })
    }
  } catch (e) {
    const err = e instanceof SmaregiError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
