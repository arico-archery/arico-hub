import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { searchProductPage, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 MakeShop 商品 조회 권한을 진단(운영자용). HMAC(AUTH_SECRET) 보호.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  try {
    const products = await searchProductPage(1, 3)
    return NextResponse.json({ ok: true, searchProduct: 'OK', count: products.length, sample: products })
  } catch (e) {
    if (e instanceof MakeshopError) {
      return NextResponse.json({ ok: false, searchProduct: 'FORBIDDEN_OR_ERROR', error: e.message, detail: e.detail })
    }
    return NextResponse.json({ ok: false, searchProduct: 'ERROR', error: String(e) })
  }
}
