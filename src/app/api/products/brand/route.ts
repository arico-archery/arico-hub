import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 브랜드 일괄 작업 (브랜드 = Product.brand 속성)
// POST body:
//   { action:'rename', supplierCode?, brand, to }            → 이름 변경/병합(updateMany)
//   { action:'delete', supplierCode?, brand, mode:'clear' }  → 브랜드만 비우기(상품 유지)
//   { action:'delete', supplierCode?, brand, mode:'products' } → 브랜드 상품 삭제(주문/발주 사용분 제외)
export async function POST(req: Request) {
  const body = await req.json() as {
    action: 'rename' | 'delete'
    supplierCode?: string
    brand: string
    to?: string
    mode?: 'clear' | 'products'
  }
  const { action, supplierCode, brand } = body
  if (!brand) return NextResponse.json({ error: 'brand required' }, { status: 400 })

  const scope = { brand, ...(supplierCode ? { supplierCode } : {}) }

  if (action === 'rename') {
    const to = (body.to ?? '').trim()
    if (!to) return NextResponse.json({ error: 'to required' }, { status: 400 })
    const r = await prisma.product.updateMany({ where: scope, data: { brand: to } })
    return NextResponse.json({ ok: true, updated: r.count })
  }

  if (action === 'delete') {
    if (body.mode === 'clear') {
      const r = await prisma.product.updateMany({ where: scope, data: { brand: '' } })
      return NextResponse.json({ ok: true, cleared: r.count })
    }
    // mode === 'products' : 주문/발주에 사용되지 않은 상품만 삭제
    const prods = await prisma.product.findMany({ where: scope, select: { id: true } })
    const ids = prods.map(p => p.id)
    if (ids.length === 0) return NextResponse.json({ ok: true, deleted: 0, skipped: 0 })

    const [oUse, pUse] = await Promise.all([
      prisma.orderItem.findMany({ where: { productId: { in: ids } }, select: { productId: true } }),
      prisma.purchaseOrderItem.findMany({ where: { productId: { in: ids } }, select: { productId: true } }),
    ])
    const inUse = new Set<number>([...oUse.map(x => x.productId), ...pUse.map(x => x.productId)])
    const deletable = ids.filter(id => !inUse.has(id))

    if (deletable.length > 0) {
      await prisma.aricoCatalog.updateMany({ where: { supplierProductId: { in: deletable } }, data: { supplierProductId: null } })
      await prisma.stockLevel.deleteMany({ where: { productId: { in: deletable } } })
      await prisma.product.deleteMany({ where: { id: { in: deletable } } })
    }
    return NextResponse.json({ ok: true, deleted: deletable.length, skipped: inUse.size })
  }

  return NextResponse.json({ error: 'invalid action' }, { status: 400 })
}
