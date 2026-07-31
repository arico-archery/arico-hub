import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAllProducts, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60   // 전 상품 동기화 — 기본 제한(10~15초)이면 타임아웃난다

// MakeShop 상품(searchProduct)을 가져와 AricoCatalog에 반영(upsert by productCode=systemCode).
// - 기존 항목: 이름·판매가·진열·JAN 이 바뀐 것만 갱신 (매칭/옵션/이미지는 보존)
// - 신규 항목: 생성
// 값이 같은 행은 건너뛰고, 쓰기는 10개씩 병렬 — 768개 순차 왕복으로 타임아웃나던 것 수정.
// POST(로그인) 와 /api/cron/sync-products(HMAC) 공용.
export async function runSyncProducts(): Promise<{ body: Record<string, unknown>; status: number }> {
  if (!makeshopConfigured()) {
    return {
      status: 503,
      body: { ok: false, error: 'not_configured', hint: 'Vercel 환경변수 MAKESHOP_GQL_ENDPOINT / MAKESHOP_API_TOKEN / MAKESHOP_API_KEY 설정 후 재배포하세요.' },
    }
  }
  try {
    const products = await getAllProducts()
    const existing = await prisma.aricoCatalog.findMany({
      select: { productCode: true, name: true, priceJpy: true, active: true, barcode: true },
    })
    const byCode = new Map(existing.map(r => [r.productCode, r]))

    type Job = { kind: 'create' | 'update'; code: string; data: { name: string; priceJpy: number; active: boolean; barcode: string } }
    const jobs: Job[] = []
    let skipped = 0, unchanged = 0
    for (const p of products) {
      const code = String(p.systemCode ?? '').trim()
      if (!code) { skipped++; continue }
      const data = {
        name: String(p.productName ?? '').trim(),
        priceJpy: Math.round(Number(p.sellPrice) || 0),
        active: p.display === 'Y',   // 자사몰 진열 여부 (N=미진열=판매안함)
        barcode: String(p.janCode ?? '').trim(),   // = 스마레지 productCode (연결 키)
      }
      const cur = byCode.get(code)
      if (!cur) jobs.push({ kind: 'create', code, data })
      else if (cur.name !== data.name || cur.priceJpy !== data.priceJpy || cur.active !== data.active || cur.barcode !== data.barcode) {
        jobs.push({ kind: 'update', code, data })
      } else unchanged++
    }

    let created = 0, updated = 0, failed = 0
    const CONC = 10
    for (let i = 0; i < jobs.length; i += CONC) {
      const res = await Promise.allSettled(jobs.slice(i, i + CONC).map(j =>
        j.kind === 'create'
          ? prisma.aricoCatalog.create({ data: { productCode: j.code, ...j.data } })
          : prisma.aricoCatalog.update({ where: { productCode: j.code }, data: j.data }),
      ))
      res.forEach((r, k) => {
        if (r.status === 'rejected') { failed++; console.error('sync-products failed:', jobs[i + k].code, (r.reason as { message?: string })?.message) }
        else if (jobs[i + k].kind === 'create') created++
        else updated++
      })
    }
    return { status: 200, body: { ok: true, fetched: products.length, created, updated, unchanged, skipped, failed } }
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return { status: 502, body: { ok: false, ...err } }
  }
}

export async function POST() {
  const { body, status } = await runSyncProducts()
  return NextResponse.json(body, { status })
}
