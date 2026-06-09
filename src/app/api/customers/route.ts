import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createWithSeqRetry } from '@/lib/seq'

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
  // 코드를 직접 지정한 경우: 그대로 생성(충돌 시 에러로 알림)
  if (body.code) {
    const customer = await prisma.customer.create({ data: body })
    return NextResponse.json(customer, { status: 201 })
  }
  // 자동 채번: 현존 최대 C### + 1 (+재시도). 동시성·삭제 안전
  const customer = await createWithSeqRetry(
    async (attempt) => {
      const last = await prisma.customer.findFirst({
        where: { code: { startsWith: 'C' } },
        orderBy: { code: 'desc' },
        select: { code: true },
      })
      const lastSeq = last ? (parseInt(last.code.slice(1), 10) || 0) : 0
      return `C${String(lastSeq + 1 + attempt).padStart(3, '0')}`
    },
    (code) => prisma.customer.create({ data: { ...body, code } }),
  )
  return NextResponse.json(customer, { status: 201 })
}
