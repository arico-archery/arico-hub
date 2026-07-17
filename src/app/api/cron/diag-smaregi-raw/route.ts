import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { smaregiGet, smaregiConfigured } from '@/lib/smaregi'

export const maxDuration = 60

// 스마레지 원본 재고를 그대로 확인하는 일회성 진단(운영자용). HMAC 보호. 읽기 전용.
// 음수 재고가 스마레지가 주는 값인지, 우리 동기화 탓인지 가리기 위함.
// 파라미터 표기를 몰라서 후보를 순서대로 시도하고, 통한 것을 알려준다.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!smaregiConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  // mode=layaway — 取り置き(예약) 수량이 전체에서 얼마나 되는지 집계
  if (url.searchParams.get('mode') === 'layaway') {
    let rows = 0, negRows = 0, layRows = 0, laySum = 0, negSum = 0
    const samples: unknown[] = []
    for (let page = 1; page <= 60; page++) {
      const rs = await smaregiGet<{ productId: string; storeId: string; stockAmount: string; layawayStockAmount: string }[]>('/pos/stock', { limit: 1000, page })
      for (const r of rs) {
        rows++
        const amt = Number(r.stockAmount) || 0
        const lay = Number(r.layawayStockAmount) || 0
        if (amt < 0) { negRows++; negSum += amt }
        if (lay !== 0) {
          layRows++; laySum += lay
          if (samples.length < 6) samples.push({ productId: r.productId, storeId: r.storeId, 재고: r.stockAmount, 取り置き: r.layawayStockAmount })
        }
      }
      if (rs.length < 1000) break
    }
    return NextResponse.json({ ok: true, mode: 'layaway', 재고행수: rows, 음수행: negRows, 음수합: negSum, 取り置き행: layRows, 取り置き합: laySum, samples })
  }

  const pid = url.searchParams.get('productId') || '5137'
  const tries: Record<string, unknown> = {}

  const attempt = async (label: string, params: Record<string, string | number>) => {
    try {
      const r = await smaregiGet<unknown[]>('/pos/stock', params)
      tries[label] = { ok: true, count: Array.isArray(r) ? r.length : 0, sample: Array.isArray(r) ? r.slice(0, 4) : r }
    } catch (e) {
      tries[label] = { ok: false, error: String(e).slice(0, 80) }
    }
  }

  await attempt('product_id', { product_id: pid, limit: 20 })
  await attempt('productId', { productId: pid, limit: 20 })
  await attempt('product_id-like', { 'product_id-like': pid, limit: 20 })

  // 필터가 전부 안 되면: 필터 없이 페이지를 훑어 해당 productId를 찾는다
  let found: unknown = null
  if (!Object.values(tries).some(t => (t as { ok: boolean }).ok)) {
    for (let page = 1; page <= 60 && !found; page++) {
      const rows = await smaregiGet<{ productId?: string }[]>('/pos/stock', { limit: 1000, page })
      const hit = rows.filter(r => String(r.productId) === pid)
      if (hit.length) found = { page, rows: hit }
      if (rows.length < 1000) break
    }
  }
  return NextResponse.json({ ok: true, productId: pid, tries, foundByScan: found })
}
