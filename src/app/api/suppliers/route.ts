import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/suppliers — 모든 공급사 반환
export async function GET() {
  const suppliers = await prisma.supplier.findMany({ orderBy: { code: 'asc' } })
  return NextResponse.json(suppliers)
}

// PATCH /api/suppliers — { code, discount, taxRate } 업데이트
export async function PATCH(req: Request) {
  const body = await req.json() as { code: string; discount?: number; taxRate?: number }
  const { code, ...data } = body
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const updated = await prisma.supplier.update({
    where: { code },
    data,
  })
  return NextResponse.json(updated)
}
