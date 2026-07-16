import { NextResponse } from 'next/server'
import { smaregiConfigured, SmaregiError } from '@/lib/smaregi'
import { syncProductsPage, syncStockPage, resetStock } from '@/lib/smaregi-sync'

export const maxDuration = 60

// POST /api/smaregi/sync-inventory  body: { phase?, page? }
// 스마레지 상품·재고를 캐시로 동기화(로그인 필요). 요청당 시간예산(~48초)까지 여러 페이지 처리,
// 남으면 nextPhase/nextPage 반환 → 클라이언트가 이어서 호출.
export async function POST(req: Request) {
  if (!smaregiConfigured()) {
    return NextResponse.json({ ok: false, error: 'not_configured', hint: 'Vercel 환경변수 SMAREGI_* 설정 후 재배포하세요.' }, { status: 503 })
  }
  let body: { phase?: string; page?: number } = {}
  try { body = await req.json() } catch { /* 빈 바디 허용 */ }
  let phase: 'products' | 'stock' = body.phase === 'stock' ? 'stock' : 'products'
  let page = Math.max(1, Number(body.page) || 1)
  const agg = { products: 0, stock: 0 }
  const t0 = Date.now()

  try {
    while (Date.now() - t0 < 48000) {
      if (phase === 'products') {
        const { count, done } = await syncProductsPage(page)
        agg.products += count
        if (done) { await resetStock(); phase = 'stock'; page = 1 } else page++
      } else {
        const { count, done } = await syncStockPage(page)
        agg.stock += count
        if (done) return NextResponse.json({ ok: true, done: true, ...agg })
        page++
      }
    }
    return NextResponse.json({ ok: true, done: false, next: { phase, page }, ...agg })
  } catch (e) {
    const err = e instanceof SmaregiError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
