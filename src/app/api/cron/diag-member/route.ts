import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopConfigured, makeshopQuery } from '@/lib/makeshop'

export const maxDuration = 60

// 회원 주소 필드 진단(운영자용, HMAC). 저장된 주소에 번지·건물명이 빠지는 원인을 찾기 위해
// MakeShop 이 실제로 어떤 필드를 주는지 원본 그대로 본다.
//   ?fields=... 로 필드 목록을 바꿔가며 시험할 수 있다(존재하지 않는 필드는 GraphQL 에러 → 메시지로 확인).
//   ?member=<memberId> 로 특정 회원만.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const fields = (url.searchParams.get('fields') || 'memberId name nameKana email tel etcphone hpost haddress1 haddressAddr haddress2').trim()
  const member = url.searchParams.get('member') || ''
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 5))

  try {
    const data = await makeshopQuery<{ searchMember?: { members?: Record<string, unknown>[] } }>(
      `query searchMember($input: SearchMemberRequest!){ searchMember(input: $input){ members { ${fields} } } }`,
      { input: { page: 1, limit: member ? 1000 : limit, ...(member ? { memberId: member } : {}) } },
    )
    let members = data.searchMember?.members ?? []
    if (member) members = members.filter(m => String(m.memberId) === member)
    return NextResponse.json({ ok: true, fields, count: members.length, members: members.slice(0, limit) })
  } catch (e) {
    const err = e as { message?: string; detail?: unknown }
    return NextResponse.json({ ok: false, fields, error: err.message ?? String(e), detail: err.detail }, { status: 200 })
  }
}
