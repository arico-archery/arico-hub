import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAllMembersDetailed, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

export const maxDuration = 60

// 거래처명이 회원ID(숫자)로 남는 원인 진단(운영자용). HMAC 보호.
// ?ids=201012000001,210224000001,... — MakeShop 회원목록에 존재하는지 + name 필드 실제값 확인.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const ids = (url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean)

  try {
    const members = await getAllMembersDetailed()
    const byId = new Map(members.map(m => [m.memberId, m]))

    // 전체 회원 중 name이 빈 건이 얼마나 되는지
    const emptyName = members.filter(m => !(m.name || '').trim())

    // 조회 대상 각각: MakeShop에 존재하는가 / name이 실제로 무엇인가
    const probe = ids.map(id => {
      const m = byId.get(id)
      if (!m) return { id, inMakeshop: false }
      return {
        id, inMakeshop: true,
        name: m.name ?? null, nameKana: m.nameKana ?? null,
        email: m.email ?? null, tel: m.tel ?? null,
        raw: m,   // 다른 필드에 이름이 들어있는지 확인용
      }
    })

    return NextResponse.json({
      ok: true,
      totalMembers: members.length,
      emptyNameCount: emptyName.length,
      emptyNameSample: emptyName.slice(0, 5),
      probed: ids.length,
      foundInMakeshop: probe.filter(p => p.inMakeshop).length,
      probe,
    })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
