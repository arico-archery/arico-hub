import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAllMembersDetailed, memberPostal, memberAddress, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

// POST /api/makeshop/sync-members
// MakeShop 회원 전체를 가져와 거래처(Customer)에 반영(externalMemberId 기준 생성/갱신).
// 이름·이메일·전화·주소·우편번호를 채운다(값 있는 것만). 기존 수동 등록 거래처는 안 건드림.
export async function POST() {
  if (!makeshopConfigured()) {
    return NextResponse.json({ ok: false, error: 'not_configured', hint: 'Vercel 환경변수 설정 후 재배포하세요.' }, { status: 503 })
  }
  try {
    const members = await getAllMembersDetailed()
    const existing = new Map(
      (await prisma.customer.findMany({ where: { externalMemberId: { not: '' } }, select: { id: true, externalMemberId: true } })).map(c => [c.externalMemberId, c.id]),
    )
    const lastCust = await prisma.customer.findFirst({ where: { code: { startsWith: 'C' } }, orderBy: { code: 'desc' }, select: { code: true } })
    let seq = lastCust ? (parseInt(lastCust.code.slice(1), 10) || 0) : 0

    let created = 0, updated = 0
    for (const m of members) {
      if (!m.memberId) continue
      const data: Record<string, string> = {}
      if (m.name) data.name = m.name
      if (m.email) data.email = m.email
      if (m.tel) data.phone = m.tel
      const addr = memberAddress(m); if (addr) data.address = addr
      const pc = memberPostal(m); if (pc) data.postalCode = pc
      const id = existing.get(m.memberId)
      if (id) {
        if (Object.keys(data).length) await prisma.customer.update({ where: { id }, data })
        updated++
      } else {
        seq += 1
        const c = await prisma.customer.create({ data: { code: `C${String(seq).padStart(3, '0')}`, name: data.name || m.memberId, externalMemberId: m.memberId, email: data.email || '', phone: data.phone || '', address: data.address || '', postalCode: data.postalCode || '' } })
        existing.set(m.memberId, c.id)
        created++
      }
    }
    return NextResponse.json({ ok: true, fetched: members.length, created, updated })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
