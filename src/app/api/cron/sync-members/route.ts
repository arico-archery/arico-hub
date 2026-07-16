import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopConfigured } from '@/lib/makeshop'
import { syncMembersPage, PAGE_LIMIT } from '@/app/api/makeshop/sync-members/route'

export const maxDuration = 60

// 로그인 없이 회원 동기화 트리거(운영자용). HMAC(AUTH_SECRET) 보호.
// 한 요청에서 시간 여유(약 50초)까지 여러 페이지 처리하고, 남으면 nextPage 반환.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const mode = url.searchParams.get('mode') === 'new' ? 'new' : 'all'
  let page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const agg = { fetched: 0, created: 0, updated: 0, skipped: 0, marked: 0 }
  const t0 = Date.now()
  while (true) {
    const pageStart = Date.now()
    const r = await syncMembersPage(mode, page, PAGE_LIMIT)
    const pageMs = Date.now() - pageStart
    agg.fetched += r.count; agg.created += r.created; agg.updated += r.updated; agg.skipped += r.skipped; agg.marked += r.marked
    if (!r.hasMore) return NextResponse.json({ ok: true, done: true, ...agg })
    page++
    // 다음 페이지가 방금 페이지만큼 걸린다고 보고, 60초(maxDuration) 안에 못 끝낼 것 같으면 넘긴다.
    // (예전엔 경과시간만 봐서, 다음 페이지 도중 함수가 통째로 죽었다 → FUNCTION_INVOCATION_TIMEOUT)
    if (Date.now() - t0 + pageMs > 50000) return NextResponse.json({ ok: true, done: false, nextPage: page, ...agg })
  }
}
