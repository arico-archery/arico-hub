import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopQuery, makeshopConfigured } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 basket 옵션 후보필드를 하나씩 시험(진단). HMAC 보호.
// ?from=YYYYMMDD&to=YYYYMMDD&sys=systemOrderNumber
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const okAuth = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!okAuth) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from') || '20260222'
  const to = url.searchParams.get('to') || '20260222'
  const sys = url.searchParams.get('sys') || ''
  const fields = (url.searchParams.get('fields') || 'variationName,variationJanCode,optionCode,productNameOptions,variation1ItemId,variation2ItemId,productCustomCode,addcode')
    .split(',').map(s => s.trim()).filter(Boolean)

  const results: Record<string, unknown> = {}
  for (const f of fields) {
    try {
      const q = `query searchOrder($input: SearchOrderRequest!){ searchOrder(input: $input){ orders { systemOrderNumber deliveryInfos { basketInfos { productName ${f} } } } } }`
      type B = Record<string, unknown>
      const data = await makeshopQuery<{ searchOrder?: { orders?: { systemOrderNumber: string; deliveryInfos?: { basketInfos?: B[] }[] }[] } }>(
        q, { input: { startOrderDate: `${from}000000`, endOrderDate: `${to}235959`, page: 1, limit: 100 } },
      )
      const hit = (data.searchOrder?.orders ?? []).filter(o => !sys || o.systemOrderNumber === sys)
      const vals = hit.flatMap(o => (o.deliveryInfos || []).flatMap(d => (d.basketInfos || []).map(b => ({ name: String(b.productName).slice(0, 28), [f]: b[f] }))))
      results[f] = { ok: true, vals: vals.slice(0, 3) }
    } catch (e) {
      results[f] = { ok: false, error: String(e).slice(0, 70) }
    }
  }
  return NextResponse.json({ ok: true, results })
}
