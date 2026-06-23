import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// DELETE /api/arico-catalog/[id] — 수동(이벤트) 상품만 삭제 가능. 크롤 상품은 보호.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await prisma.aricoCatalog.findUnique({ where: { id: Number(id) }, select: { productCode: true } })
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!item.productCode.startsWith('EVENT-')) {
    return NextResponse.json({ error: 'not_manual', message: '크롤 상품은 삭제할 수 없습니다 (수동/이벤트 상품만 삭제 가능)' }, { status: 403 })
  }
  await prisma.aricoCatalog.delete({ where: { id: Number(id) } })
  return NextResponse.json({ ok: true })
}
