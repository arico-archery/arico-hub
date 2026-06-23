import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// DELETE /api/arico-catalog/[id] — 카탈로그 상품 삭제 (이벤트/수동 상품 정리용)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.aricoCatalog.delete({ where: { id: Number(id) } })
  return NextResponse.json({ ok: true })
}
