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
  // 객체/배열형 옵션필드 후보 — 하위필드까지 포함한 표현
  const candidates = [
    'optionInfos { optionTitle optionValue }',
    'optionInfos { title value }',
    'optionInfos { optionName optionValue }',
    'optionInfos { name value }',
    'orderProductOptionInfos { optionTitle optionValue }',
    'productOptionInfos { optionTitle optionValue }',
    'orderOptionInfos { optionTitle optionValue }',
    'options { optionTitle optionValue }',
    'basketOptionInfos { optionTitle optionValue }',
  ]

  const results: Record<string, unknown> = {}
  for (const f of candidates) {
    const fieldName = f.split(/[\s{]/)[0]   // 표현에서 필드명 추출
    try {
      const q = `query searchOrder($input: SearchOrderRequest!){ searchOrder(input: $input){ orders { systemOrderNumber deliveryInfos { basketInfos { productName variationCustomCode ${f} } } } } }`
      const data = await makeshopQuery<{ searchOrder?: { orders?: { deliveryInfos?: { basketInfos?: Record<string, unknown>[] }[] }[] } }>(q, { input: { startOrderDate: start, endOrderDate: end, page: 1, limit: 50 } })
      // ARICO STRING 품목의 그 필드값 샘플
      const samples: unknown[] = []
      for (const o of data.searchOrder?.orders ?? []) {
        for (const d of o.deliveryInfos ?? []) {
          for (const b of d.basketInfos ?? []) {
            if (String(b.productName ?? '').includes('ARICO STRING') && samples.length < 2) {
              samples.push({ name: b.productName, opt: b[fieldName] })
            }
          }
        }
      }
      results[f] = { ok: true, samples }
    } catch (e) {
      results[f] = { ok: false, error: String(e).slice(0, 80) }
    }
  }
  return NextResponse.json({ ok: true, results })
}
