import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const DEFAULT_KEYS = [
  'bank_name',
  'bank_branch',
  'bank_account_type',
  'bank_account_no',
  'bank_account_holder',
  'bank_note',
  // 발행처(ARICO) 정보 — 청구서/견적서/발주서 문서에 사용
  'company_name',
  'company_regno',
  'company_address',
  'company_tel',
  'company_email',
  'company_web',
]

// GET /api/settings — 모든 설정 반환 { key: value }
export async function GET() {
  const rows = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM Setting
  `
  const map: Record<string, string> = {}
  for (const k of DEFAULT_KEYS) map[k] = ''
  for (const r of rows) map[r.key] = r.value
  return NextResponse.json(map)
}

// POST /api/settings — body: { key: value, ... } 업서트
export async function POST(req: Request) {
  const body = await req.json() as Record<string, string>
  for (const [key, value] of Object.entries(body)) {
    await prisma.$executeRaw`
      INSERT INTO Setting (key, value, updatedAt)
      VALUES (${key}, ${value}, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP
    `
  }
  return NextResponse.json({ ok: true })
}
