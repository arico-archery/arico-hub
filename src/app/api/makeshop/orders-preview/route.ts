import { NextResponse } from 'next/server'
import { searchOrdersDetailed, fmtOrderDate, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

// GET /api/makeshop/orders-preview?days=90
// 최근 주문을 상세 필드로 가져와 원본 그대로 보여준다(읽기전용, 필드명 검증 + 매칭키 확인용).
export async function GET(req: Request) {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days')) || 90))
  const now = new Date()
  const start = fmtOrderDate(new Date(now.getTime() - days * 86400000))
  const end = fmtOrderDate(now)
  try {
    const orders = await searchOrdersDetailed(start, end, 1, 20)
    return NextResponse.json({ ok: true, range: { start, end }, count: orders.length, orders })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
