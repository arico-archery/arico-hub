import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStockByBarcodes, SMAREGI_ENABLED } from '@/lib/smaregi'

// POST /api/online-sku/sync
// ARICO 온라인샵 재고를 MakeShop/Smaregi에서 동기화 (연결키 = 바코드 JAN).
// ⚠️ API 키 제공 전엔 스텁 — SMAREGI_ENABLED=false면 not_configured.
//    API 들어오면 src/lib/smaregi.ts 의 getStockByBarcodes 만 실제 호출로 채우면 동작.
//    (확장: 동기화가 미등록 JAN의 SKU 행을 자동 생성하도록 보강 가능)
export async function POST() {
  if (!SMAREGI_ENABLED) {
    return NextResponse.json({
      ok: false,
      reason: 'not_configured',
      message: 'Smaregi/MakeShop API 미연동 — 키 제공 후 src/lib/smaregi.ts 활성화 시 자동 동작합니다. 그 전까지는 수동으로 재고를 관리하세요.',
    })
  }

  const skus = await prisma.onlineSku.findMany({ where: { NOT: { barcode: '' } }, select: { id: true, barcode: true } })
  const stockMap = await getStockByBarcodes(skus.map(s => s.barcode))

  const now = new Date()
  let updated = 0
  for (const s of skus) {
    const qty = stockMap.get(s.barcode)
    if (qty === undefined) continue
    await prisma.onlineSku.update({ where: { id: s.id }, data: { stockQty: qty, source: 'smaregi', syncedAt: now } })
    updated++
  }
  return NextResponse.json({ ok: true, updated, total: skus.length, syncedAt: now })
}
