import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { smaregiGet, smaregiConfigured, SmaregiError } from '@/lib/smaregi'

export const maxDuration = 60

// 스마레지 원본 재고를 그대로 확인하는 일회성 진단(운영자용). HMAC 보호. 읽기 전용.
// ?productId=5137 — 음수 재고가 스마레지가 주는 값인지, 우리 동기화 탓인지 가리기 위함.
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
    // 해당 상품의 매장별 재고 원본
    const stock = await smaregiGet<unknown[]>('/pos/stock', { product_id: productId, limit: 50 })
    // 상품 정보도 함께
    const prod = await smaregiGet<unknown[]>('/pos/products', { product_id: productId, limit: 5 })
    return NextResponse.json({ ok: true, productId, 재고원본: stock, 상품원본: prod })
  } catch (e) {
    const err = e instanceof SmaregiError ? { error: e.message } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
