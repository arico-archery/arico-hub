import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { getAllOrdersDetailed, makeshopConfigured, MakeshopError } from '@/lib/makeshop'
import { resolveOptionLabels, extractOptionCode } from '@/lib/smaregi-option'

export const maxDuration = 60

const EXCLUDE = /レンタルリム/
// ① variationName(베리에이션/옵션그룹) ② customSelects(커스텀셀렉트) 순
function basketOptionLabel(b: { variationName?: string; customSelects?: { customSelectName?: string; selectedItemName?: string }[] }): string {
  const v = (b.variationName || '').replace(/\s+/g, ' ').trim()
  if (v) return v
  return (b.customSelects || [])
    .map(c => `${(c.customSelectName || '').trim()}: ${(c.selectedItemName || '').trim()}`)
    .filter(s => s !== ': ')
    .join(' / ')
}

// 로그인 없이 기존 주문의 옵션 라벨을 MakeShop 재조회로 백필(운영자용). HMAC 보호.
// ?from=YYYYMMDD&to=YYYYMMDD — 그 구간 주문의 customSelects/코드를 optionLabel에 채움.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const from = url.searchParams.get('from'); const to = url.searchParams.get('to')
  if (!from || !/^\d{8}$/.test(from) || !to || !/^\d{8}$/.test(to)) {
    return NextResponse.json({ ok: false, error: 'from/to(YYYYMMDD) 필요' }, { status: 400 })
  }

  try {
    const orders = await getAllOrdersDetailed(`${from}000000`, `${to}235959`)
    // 미리 옵션코드→스마레지 라벨 맵
    const allCodes = orders.flatMap(o => (o.deliveryInfos || []).flatMap(d => (d.basketInfos || []).map(b => b.variationCustomCode)))
    const smMap = await resolveOptionLabels(allCodes)

    const dbOrders = new Map((await prisma.order.findMany({
      where: { externalOrderNo: { in: orders.map(o => o.systemOrderNumber) } },
      select: { id: true, externalOrderNo: true, items: { select: { id: true }, orderBy: { id: 'asc' } } },
    })).map(o => [o.externalOrderNo, o]))

    let updated = 0, skipped = 0
    const ups: { id: number; label: string; shopName: string }[] = []
    for (const o of orders) {
      const dbo = dbOrders.get(o.systemOrderNumber)
      if (!dbo) { skipped++; continue }
      // import와 동일하게 レンタルリム 제외한 basket 순서로 zip
      const baskets = (o.deliveryInfos || []).flatMap(d => d.basketInfos || []).filter(b => !EXCLUDE.test(b.productName || ''))
      for (let i = 0; i < dbo.items.length && i < baskets.length; i++) {
        const b = baskets[i]
        const label = basketOptionLabel(b) || smMap.get(extractOptionCode(b.variationCustomCode) || '') || ''
        const shopName = (b.productName || '').trim()   // 고객이 실제 주문한 자사몰 상품명
        if (label || shopName) ups.push({ id: dbo.items[i].id, label, shopName })
      }
    }
    for (let i = 0; i < ups.length; i += 20) {
      await Promise.allSettled(ups.slice(i, i + 20).map(u => prisma.orderItem.update({
        where: { id: u.id },
        data: { ...(u.label ? { optionLabel: u.label } : {}), ...(u.shopName ? { shopProductName: u.shopName } : {}) },
      })))
    }
    updated = ups.length
    return NextResponse.json({ ok: true, fetched: orders.length, matchedOrders: dbOrders.size, updated, skipped })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
