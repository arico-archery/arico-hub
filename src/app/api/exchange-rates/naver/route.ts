import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Frankfurter API (유럽중앙은행 공식 환율, 무료·인증 불필요)
// POST /api/exchange-rates/naver
export async function POST() {
  try {
    // USD→JPY, EUR→JPY 동시 조회
    const [usdRes, eurRes] = await Promise.all([
      fetch('https://api.frankfurter.app/latest?base=USD&symbols=JPY', { cache: 'no-store' }),
      fetch('https://api.frankfurter.app/latest?base=EUR&symbols=JPY', { cache: 'no-store' }),
    ])

    if (!usdRes.ok || !eurRes.ok) throw new Error('Frankfurter API 응답 오류')

    const [usdData, eurData] = await Promise.all([usdRes.json(), eurRes.json()])
    const usdJpy = Number(usdData.rates?.JPY)
    const eurJpy = Number(eurData.rates?.JPY)

    if (!usdJpy || !eurJpy) throw new Error('환율 데이터 파싱 실패')

    // DB 업데이트 (JPY는 항상 1.0)
    await Promise.all([
      prisma.exchangeRate.upsert({
        where: { currency: 'USD' },
        update: { rateToJpy: Math.round(usdJpy * 100) / 100 },
        create: { currency: 'USD', rateToJpy: Math.round(usdJpy * 100) / 100 },
      }),
      prisma.exchangeRate.upsert({
        where: { currency: 'EUR' },
        update: { rateToJpy: Math.round(eurJpy * 100) / 100 },
        create: { currency: 'EUR', rateToJpy: Math.round(eurJpy * 100) / 100 },
      }),
      prisma.exchangeRate.upsert({
        where: { currency: 'JPY' },
        update: { rateToJpy: 1 },
        create: { currency: 'JPY', rateToJpy: 1 },
      }),
    ])

    return NextResponse.json({
      success: true,
      rates: { USD: Math.round(usdJpy * 100) / 100, EUR: Math.round(eurJpy * 100) / 100 },
      source: 'Frankfurter (ECB)',
      date: usdData.date,
    })
  } catch (e) {
    console.error('Exchange rate fetch error:', e)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
