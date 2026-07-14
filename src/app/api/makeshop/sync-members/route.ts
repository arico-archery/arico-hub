import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAllMembersDetailed, memberPostal, memberAddress, makeshopConfigured, MakeshopError } from '@/lib/makeshop'
import { maxCustomerSeq } from '@/lib/seq'

export const maxDuration = 60

// POST /api/makeshop/sync-members?mode=all|new
// MakeShop 회원 전체를 가져와 거래처(Customer)에 반영(externalMemberId 기준 생성/갱신).
// mode=new: 기존 거래처는 갱신하지 않고 **신규 회원만 생성**(대량 갱신 생략 → 빠름).
export async function POST(req: Request) {
  if (!makeshopConfigured()) {
    return NextResponse.json({ ok: false, error: 'not_configured', hint: 'Vercel 환경변수 설정 후 재배포하세요.' }, { status: 503 })
  }
  const mode = new URL(req.url).searchParams.get('mode') === 'new' ? 'new' : 'all'
  try {
    const members = await getAllMembersDetailed()
    const existing = new Map(
      (await prisma.customer.findMany({ where: { externalMemberId: { not: '' } }, select: { id: true, externalMemberId: true } })).map(c => [c.externalMemberId, c.id]),
    )
    let seq = await maxCustomerSeq()

    let created = 0, updated = 0, skipped = 0
    for (const m of members) {
      if (!m.memberId) continue
      const id = existing.get(m.memberId)
      if (id && mode === 'new') { skipped++; continue }   // 신규만: 기존은 건드리지 않음(빠름)
      const data: Record<string, string> = {}
      if (m.name) data.name = m.name
      if (m.nameKana) data.nameKana = m.nameKana
      if (m.email) data.email = m.email
      if (m.tel) data.phone = m.tel
      const addr = memberAddress(m); if (addr) data.address = addr
      const pc = memberPostal(m); if (pc) data.postalCode = pc
      if (id) {
        if (Object.keys(data).length) await prisma.customer.update({ where: { id }, data })
        updated++
      } else {
        seq += 1
        const c = await prisma.customer.create({ data: { code: `C${String(seq).padStart(3, '0')}`, name: data.name || m.memberId, nameKana: data.nameKana || '', externalMemberId: m.memberId, email: data.email || '', phone: data.phone || '', address: data.address || '', postalCode: data.postalCode || '' } })
        existing.set(m.memberId, c.id)
        created++
      }
    }
    return NextResponse.json({ ok: true, fetched: members.length, created, updated, skipped })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
