import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const customers = await prisma.customer.findMany({
    include: {
      _count: { select: { orders: true } },
      orders: {
        select: { totalAmountJpy: true, paidAmountJpy: true },
      },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(customers)
}

export async function POST(req: Request) {
  const body = await req.json()
  // Auto-generate customer code if not provided
  if (!body.code) {
    const count = await prisma.customer.count()
    body.code = `C${String(count + 1).padStart(3, '0')}`
  }
  const customer = await prisma.customer.create({ data: body })
  return NextResponse.json(customer, { status: 201 })
}
