import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const rates = await prisma.exchangeRate.findMany()
  return NextResponse.json(rates)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { currency, rateToJpy } = body
  const updated = await prisma.exchangeRate.upsert({
    where: { currency },
    update: { rateToJpy: Number(rateToJpy) },
    create: { currency, rateToJpy: Number(rateToJpy) },
  })
  return NextResponse.json(updated)
}
