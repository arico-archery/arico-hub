import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { smaregiGet, smaregiConfigured, SmaregiError } from '@/lib/smaregi'

export const maxDuration = 60

// 로그인 없이 특정 상품의 매장별 재고를 조회(진단). HMAC 보호.
// ?productId=12512
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!smaregiConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const productId = url.searchParams.get('productId') || ''
  if (!productId) return NextResponse.json({ ok: false, error: 'productId 필요' }, { status: 400 })

  try {
    // 상품ID로 재고 필터 (매장별 레코드)
    const stock = await smaregiGet<Record<string, unknown>[]>('/pos/stock', { product_id: productId, limit: 100 })
    // 참고: 매장 목록도 함께
    let stores: Record<string, unknown>[] = []
    try { stores = await smaregiGet<Record<string, unknown>[]>('/pos/stores', { limit: 100 }) } catch { /* 무시 */ }
    return NextResponse.json({
      ok: true, productId,
      stock: stock.map(s => ({ storeId: s.storeId, stockAmount: s.stockAmount, layaway: s.layawayStockAmount, upd: s.updDateTime })),
      stores: stores.map(s => ({ storeId: s.storeId, storeName: s.storeName })),
    })
  } catch (e) {
    const err = e instanceof SmaregiError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
