import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopQuery, makeshopConfigured } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 SearchedProduct의 후보 필드 존재 여부를 하나씩 시험(진단). HMAC 보호.
// ?fields=display,soldOut,... 각 필드를 개별 쿼리로 시도해 ok/에러 + 샘플값 보고.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const okAuth = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!okAuth) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const candidates = (url.searchParams.get('fields') || 'display,soldOut,soldout,sellState,sellStatus,salesStatus,openState,useYn,stockQty,productType,salesType,discontinued,isDisplay,onSale,status,visible')
    .split(',').map(s => s.trim()).filter(Boolean)

  const results: Record<string, unknown> = {}
  for (const f of candidates) {
    try {
      const data = await makeshopQuery<{ searchProduct?: { products?: Record<string, unknown>[] } }>(
        `query searchProduct($input: SearchProductRequest!){ searchProduct(input: $input){ products { systemCode ${f} } } }`,
        { input: { page: 1, limit: 5 } },
      )
      const prods = data.searchProduct?.products ?? []
      results[f] = { ok: true, samples: prods.map(p => ({ code: p.systemCode, [f]: p[f] })) }
    } catch (e) {
      results[f] = { ok: false, error: String(e).slice(0, 120) }
    }
  }
  return NextResponse.json({ ok: true, results })
}
