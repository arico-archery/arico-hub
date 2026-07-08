import { NextResponse } from 'next/server'
import {
  getShop, searchProductPage, searchMemberPage, searchOrderPage, fmtOrderDate,
  makeshopConfigured, MakeshopError,
} from '@/lib/makeshop'

// GET /api/makeshop/diag — 각 오퍼레이션 권한(스코프) 진단.
// getShop / searchProduct / searchMember / searchOrder 를 1건씩 시도해 ok/forbidden/error 를 보고.
type Probe = { ok: boolean; error?: string; detail?: unknown; count?: number }
async function probe(fn: () => Promise<unknown[] | unknown>): Promise<Probe> {
  try {
    const r = await fn()
    return { ok: true, count: Array.isArray(r) ? r.length : undefined }
  } catch (e) {
    if (e instanceof MakeshopError) return { ok: false, error: e.message, detail: e.detail }
    return { ok: false, error: String(e) }
  }
}

export async function GET() {
  if (!makeshopConfigured()) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  }
  const now = new Date()
  const start = fmtOrderDate(new Date(now.getTime() - 30 * 86400000)) // 최근 30일
  const end = fmtOrderDate(now)
  const results = {
    getShop: await probe(() => getShop()),
    searchProduct: await probe(() => searchProductPage(1, 1)),
    searchMember: await probe(() => searchMemberPage(1, 1)),
    searchOrder: await probe(() => searchOrderPage(start, end, 1, 1)),
  }
  return NextResponse.json({ ok: true, range: { start, end }, results })
}
