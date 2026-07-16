import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAllProducts, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

// POST /api/makeshop/sync-products
// MakeShop 상품(searchProduct)을 가져와 AricoCatalog에 반영(upsert by productCode=systemCode).
// - 기존 항목: 이름·판매가만 갱신 (매칭/JAN/옵션/이미지는 보존)
// - 신규 항목: 생성
// 로그인 필요(미들웨어). 환경변수 미설정 시 503.
export async function POST() {
  if (!makeshopConfigured()) {
    return NextResponse.json({
      ok: false, error: 'not_configured',
      hint: 'Vercel 환경변수 MAKESHOP_GQL_ENDPOINT / MAKESHOP_API_TOKEN / MAKESHOP_API_KEY 설정 후 재배포하세요.',
    }, { status: 503 })
  }
  try {
    const products = await getAllProducts()
    // 기존 카탈로그 코드 미리 로드 → created/updated 구분
    const existing = new Set(
      (await prisma.aricoCatalog.findMany({ select: { productCode: true } })).map(r => r.productCode),
    )
    let created = 0, updated = 0, skipped = 0
    for (const p of products) {
      const code = String(p.systemCode ?? '').trim()
      if (!code) { skipped++; continue }
      const name = String(p.productName ?? '').trim()
      const priceJpy = Math.round(Number(p.sellPrice) || 0)
      const active = p.display === 'Y'   // 자사몰 진열 여부 (N=미진열=판매안함)
      const barcode = String(p.janCode ?? '').trim()   // = 스마레지 productCode (연결 키)
      await prisma.aricoCatalog.upsert({
        where: { productCode: code },
        update: { name, priceJpy, active, barcode },
        create: { productCode: code, name, priceJpy, active, barcode },
      })
      if (existing.has(code)) updated++; else created++
    }
    return NextResponse.json({ ok: true, fetched: products.length, created, updated, skipped })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
