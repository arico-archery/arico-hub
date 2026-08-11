import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { extractOptionCode } from '@/lib/smaregi-option'

// GET /api/smaregi/stock-lookup?ids=1,2,3&codes=1500000000660,...
// 주문 화면에서 라인별 매장 재고(스마레지)를 보여주기 위한 조회.
// 연결 경로 2가지 — ①옵션코드(=스마레지 상품코드)가 있으면 그것으로 직접
//   ②공급사 상품 id → (상품 바코드 | 그 상품에 매칭된 카탈로그의 바코드) → 스마레지 상품코드
// 반환: { byId: { [productId]: {total,tokyo,aichi} }, byCode: { [code]: {...} } }
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ids = (searchParams.get('ids') ?? '').split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
  const codes = (searchParams.get('codes') ?? '').split(',')
    .map(c => extractOptionCode(c)).filter((c): c is string => !!c)

  const byId: Record<number, { total: number; tokyo: number; aichi: number }> = {}
  const byCode: Record<string, { total: number; tokyo: number; aichi: number }> = {}
  if (!ids.length && !codes.length) return NextResponse.json({ byId, byCode })

  try {
    // 상품 id → 바코드 후보 (상품 자체 barcode + 매칭된 카탈로그 barcode)
    const codeOfId = new Map<number, string>()
    if (ids.length) {
      const [prods, cats] = await Promise.all([
        prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, barcode: true } }),
        prisma.aricoCatalog.findMany({
          where: { supplierProductId: { in: ids }, NOT: { barcode: '' } },
          select: { supplierProductId: true, barcode: true },
        }),
      ])
      for (const p of prods) if (p.barcode) codeOfId.set(p.id, p.barcode)
      for (const c of cats) if (c.supplierProductId != null && !codeOfId.has(c.supplierProductId)) {
        codeOfId.set(c.supplierProductId, c.barcode)
      }
    }

    const allCodes = [...new Set([...codes, ...codeOfId.values()])]
    if (!allCodes.length) return NextResponse.json({ byId, byCode })
    const rows = await prisma.smaregiProduct.findMany({
      where: { productCode: { in: allCodes } },
      select: { productCode: true, stock: true, stockTokyo: true, stockAichi: true },
    })
    const sm = new Map(rows.map(r => [r.productCode, { total: r.stock, tokyo: r.stockTokyo, aichi: r.stockAichi }]))
    for (const c of codes) { const v = sm.get(c); if (v) byCode[c] = v }
    for (const [id, code] of codeOfId) { const v = sm.get(code); if (v) byId[id] = v }
    return NextResponse.json({ byId, byCode })
  } catch (e) {
    console.error('stock-lookup error:', e)
    return NextResponse.json({ byId, byCode })
  }
}
