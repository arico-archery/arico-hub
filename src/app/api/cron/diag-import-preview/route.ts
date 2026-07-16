import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { MakeshopError, makeshopConfigured } from '@/lib/makeshop'
import { buildPreview, refreshExisting } from '@/app/api/makeshop/import-orders/route'

export const maxDuration = 60

// MakeShop 수신이 무엇을 바꿀지 쓰기 없이 미리 보는 도구(운영자용). HMAC 보호.
//
// ?days=N (기본 90) — 신규 생성 건수 + 이미 받은 주문 중 자사몰의 현재 상태
// (입금·발송·취소)를 반영해 바뀔 건수와 그 내역을 돌려준다. DB에 쓰지 않는다.
//
// 로컬과 운영이 같은 DB를 쓰므로, 범위가 큰 수신 전에 영향을 먼저 확인할 때 쓴다.
// 예: curl ".../api/cron/diag-import-preview?token=<HMAC>&days=90"
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 90))
  try {
    const { rows } = await buildPreview(days)
    const { refreshed, changes } = await refreshExisting(rows, true)   // dryRun
    const dup = rows.filter(r => r.dup).length
    return NextResponse.json({
      ok: true, days,
      total: rows.length,
      newOrders: rows.filter(r => !r.dup && r.items.length > 0).length,
      alreadyImported: dup,
      wouldRefresh: refreshed,
      wouldStaySame: dup - refreshed,
      changes,
    })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
