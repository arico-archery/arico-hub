import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStockByBarcodes, SMAREGI_ENABLED } from '@/lib/smaregi'

// POST /api/arico-catalog/sync-stock
// ARICO 온라인샵 재고를 MakeShop/Smaregi에서 동기화한다. (연결 키 = 바코드 JAN)
// ⚠️ API 키 제공 전엔 스텁 — SMAREGI_ENABLED=false면 not_configured 반환.
//    API 들어오면 src/lib/smaregi.ts 의 getStockByBarcodes 만 실제 호출로 채우면 동작.
export async function POST() {
  if (!SMAREGI_ENABLED) {
    return NextResponse.json({
      ok: false,
      reason: 'not_configured',
      message: 'Smaregi/MakeShop API 미연동 — 키 제공 후 src/lib/smaregi.ts 활성화 시 자동 동작합니다.',
    })
  }

  // 바코드(JAN) 보유 카탈로그만 대상
  const items = await prisma.aricoCatalog.findMany({
    where: { NOT: { barcode: '' } },
    select: { id: true, barcode: true },
  })
  const stockMap = await getStockByBarcodes(items.map(i => i.barcode))

  const now = new Date()
  let updated = 0
  for (const it of items) {
    const qty = stockMap.get(it.barcode)
    if (qty === undefined) continue
    await prisma.aricoCatalog.update({
      where: { id: it.id },
      data: { onlineStockQty: qty, stockSyncedAt: now },
    })
    updated++
  }
  return NextResponse.json({ ok: true, updated, total: items.length, syncedAt: now })
}
