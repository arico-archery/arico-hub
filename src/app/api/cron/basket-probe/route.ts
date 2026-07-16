import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopQuery, makeshopConfigured } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 SearchedOrder basketInfos의 후보 옵션필드 존재 여부를 시험(진단). HMAC 보호.
// ?fields=optionInfos,options,... &from=YYYYMMDD&to=YYYYMMDD  (ARICO STRING 품목 샘플 위주)
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const okAuth = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!okAuth) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from') || '20260612'
  const to = url.searchParams.get('to') || '20260616'
  const start = `${from}000000`, end = `${to}235959`
  const candidates = (url.searchParams.get('fields') || 'optionInfos,options,orderOptions,productOptions,selectOptions,orderProductOptions,customText,freeText,addField,orderComment,comment,note')
    .split(',').map(s => s.trim()).filter(Boolean)

  const results: Record<string, unknown> = {}
  for (const f of candidates) {
    try {
      const q = `query searchOrder($input: SearchOrderRequest!){ searchOrder(input: $input){ orders { systemOrderNumber deliveryInfos { basketInfos { productName variationCustomCode ${f} } } } } }`
      const data = await makeshopQuery<{ searchOrder?: { orders?: { deliveryInfos?: { basketInfos?: Record<string, unknown>[] }[] }[] } }>(q, { input: { startOrderDate: start, endOrderDate: end, page: 1, limit: 50 } })
      // ARICO STRING 품목의 그 필드값 샘플
      const samples: unknown[] = []
      for (const o of data.searchOrder?.orders ?? []) {
        for (const d of o.deliveryInfos ?? []) {
          for (const b of d.basketInfos ?? []) {
            if (String(b.productName ?? '').includes('ARICO STRING') && samples.length < 3) {
              samples.push({ name: b.productName, vcc: b.variationCustomCode, [f]: b[f] })
            }
          }
        }
      }
      results[f] = { ok: true, samples }
    } catch (e) {
      results[f] = { ok: false, error: String(e).slice(0, 100) }
    }
  }
  return NextResponse.json({ ok: true, results })
}
