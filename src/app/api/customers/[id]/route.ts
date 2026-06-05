import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const customer = await prisma.customer.findUnique({
    where: { id: Number(id) },
    include: {
      _count: { select: { orders: true } },
      orders: { select: { totalAmountJpy: true, paidAmountJpy: true } },
    },
  })
  if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(customer)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const customer = await prisma.customer.update({
    where: { id: Number(id) },
    data: body,
  })
  return NextResponse.json(customer)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // 주문이 있는 거래처는 삭제 불가
  const orderCount = await prisma.order.count({ where: { customerId: Number(id) } })
  if (orderCount > 0) {
    return NextResponse.json({ error: '주문이 있는 거래처는 삭제할 수 없습니다.' }, { status: 400 })
  }
  await prisma.customer.delete({ where: { id: Number(id) } })
  return NextResponse.json({ ok: true })
}
