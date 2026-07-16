import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAllProducts, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 MakeShop 商品 진열상태(display) 분포 진단(운영자용). HMAC(AUTH_SECRET) 보호.
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
    const products = await getAllProducts()
    const byDisplay: Record<string, number> = {}
    for (const p of products) byDisplay[p.display || '(빈값)'] = (byDisplay[p.display || '(빈값)'] || 0) + 1
    const hidden = products.filter(p => p.display !== 'Y')
    return NextResponse.json({
      ok: true, total: products.length, byDisplay,
      hiddenCount: hidden.length,
      hiddenSamples: hidden.slice(0, 30).map(p => ({ code: p.systemCode, name: p.productName, price: p.sellPrice, display: p.display })),
    })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
