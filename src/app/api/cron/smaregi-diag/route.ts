import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { smaregiConfigured, getProductsPage, getStockPage, SmaregiError } from '@/lib/smaregi'

export const maxDuration = 60

// 로그인 없이 Smaregi 연결·권한 진단(운영자용). HMAC(AUTH_SECRET) 보호.
// 상품/재고 조회를 1건씩 시도해 ok/에러 + 샘플을 보고.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!smaregiConfigured()) {
    return NextResponse.json({ ok: false, configured: false, hint: 'Vercel 환경변수 SMAREGI_CONTRACT_ID / SMAREGI_CLIENT_ID / SMAREGI_CLIENT_SECRET 설정 후 재배포하세요.' })
  }

  const probe = async (label: string, fn: () => Promise<unknown[]>) => {
    try {
      const rows = await fn()
      return { [label]: 'OK', count: Array.isArray(rows) ? rows.length : 0, sample: Array.isArray(rows) ? rows.slice(0, 2) : rows }
    } catch (e) {
      const err = e instanceof SmaregiError ? { error: e.message, detail: e.detail } : { error: String(e) }
      return { [label]: 'ERROR', ...err }
    }
  }

  const products = await probe('products', () => getProductsPage(1, 2))
  const stock = await probe('stock', () => getStockPage(1, 2))
  return NextResponse.json({ ok: true, configured: true, products, stock })
}
