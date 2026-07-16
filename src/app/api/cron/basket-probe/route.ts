import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAllOrdersDetailed, makeshopConfigured } from '@/lib/makeshop'

export const maxDuration = 60

// 로그인 없이 basket 원본 덤프(진단) — 옵션(variationCustomCode/customSelects)이 없는 품목의
// janCode·productName을 확인해 옵션 복원 가능성 판단. HMAC 보호.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const okAuth = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!okAuth) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from') || '20260608'
  const to = url.searchParams.get('to') || '20260618'
  const orders = await getAllOrdersDetailed(`${from}000000`, `${to}235959`)
  let noOpt = 0, noOptWithJan = 0, total = 0
  const samples: unknown[] = []
  for (const o of orders) {
    for (const d of o.deliveryInfos || []) {
      for (const b of d.basketInfos || []) {
        total++
        const hasVcc = !!(b.variationCustomCode || '').trim()
        const hasCs = (b.customSelects || []).length > 0
        if (hasVcc || hasCs) continue
        noOpt++
        if ((b.janCode || '').trim()) noOptWithJan++
        if (samples.length < 8) samples.push({ name: b.productName, productCode: b.productCode, janCode: b.janCode, vcc: b.variationCustomCode })
      }
    }
  }
  return NextResponse.json({ ok: true, totalBaskets: total, noOption: noOpt, noOptionWithJanCode: noOptWithJan, samples })
}
