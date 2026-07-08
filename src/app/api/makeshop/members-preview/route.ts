import { NextResponse } from 'next/server'
import { searchMemberDetailedPage, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

// GET /api/makeshop/members-preview — 회원 상세 필드(이메일·전화·주소) 검증용(읽기전용, 5건).
export async function GET() {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  try {
    const members = await searchMemberDetailedPage(1, 5)
    return NextResponse.json({ ok: true, count: members.length, members })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
