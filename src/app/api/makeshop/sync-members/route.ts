import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { searchMemberDetailedPage, memberPostal, memberAddress, makeshopConfigured, MakeshopError } from '@/lib/makeshop'
import { maxCustomerSeq } from '@/lib/seq'

export const maxDuration = 60

// 회원 한 페이지 동기화 (POST·cron 공용). mode=new면 기존 갱신 생략.
export async function syncMembersPage(mode: 'all' | 'new', page: number, limit: number) {
  const members = await searchMemberDetailedPage(page, limit)
  const memberIds = members.map(m => m.memberId).filter(Boolean)
  // 현재 값을 함께 읽어 "실제로 바뀐 필드"만 쓴다.
  // (예전엔 MakeShop이 준 값을 무조건 update → 매 동기화마다 전 회원 왕복 → 60초 타임아웃)
  const existing = new Map(
    (await prisma.customer.findMany({
      where: { externalMemberId: { in: memberIds } },
      select: { id: true, externalMemberId: true, name: true, nameKana: true, email: true, phone: true, address: true, postalCode: true, withdrawn: true },
    })).map(c => [c.externalMemberId, c]),
  )
  let seq = await maxCustomerSeq()
  let skipped = 0
  let marked = 0
  const creates: Record<string, unknown>[] = []
  const updates: { id: number; data: Record<string, unknown> }[] = []
  for (const m of members) {
    if (!m.memberId) continue
    const cur = existing.get(m.memberId)
    if (cur && mode === 'new') { skipped++; continue }
    const addr = memberAddress(m)
    const pc = memberPostal(m)
    // 退会会員 판정: MakeShop이 회원ID만 남기고 개인정보를 전부 지운 상태.
    // 이름이 있으면 절대 탈퇴가 아니므로, 값이 하나라도 있으면 false로 되돌린다(재가입 대응).
    const withdrawn = !(m.name || m.nameKana || m.email || m.tel || addr || pc)
    if (cur) {
      const data: Record<string, unknown> = {}
      // MakeShop이 빈 값을 준 필드는 건드리지 않는다(탈퇴 시 기존 이름을 지우지 않기 위해).
      if (m.name && m.name !== cur.name) data.name = m.name
      if (m.nameKana && m.nameKana !== cur.nameKana) data.nameKana = m.nameKana
      if (m.email && m.email !== cur.email) data.email = m.email
      if (m.tel && m.tel !== cur.phone) data.phone = m.tel
      if (addr && addr !== cur.address) data.address = addr
      if (pc && pc !== cur.postalCode) data.postalCode = pc
      if (withdrawn !== cur.withdrawn) { data.withdrawn = withdrawn; marked++ }
      if (Object.keys(data).length) updates.push({ id: cur.id, data })
    } else {
      seq += 1
      if (withdrawn) marked++
      creates.push({ code: `C${String(seq).padStart(3, '0')}`, name: m.name || m.memberId, nameKana: m.nameKana || '', externalMemberId: m.memberId, email: m.email || '', phone: m.tel || '', address: addr || '', postalCode: pc || '', withdrawn })
    }
  }
  if (creates.length) await prisma.customer.createMany({ data: creates as unknown as NonNullable<Parameters<typeof prisma.customer.createMany>[0]>['data'] })
  let updated = 0
  const CONC = 10
  for (let i = 0; i < updates.length; i += CONC) {
    const r = await Promise.allSettled(updates.slice(i, i + CONC).map(u => prisma.customer.update({ where: { id: u.id }, data: u.data })))
    updated += r.filter(x => x.status === 'fulfilled').length
  }
  return { page, count: members.length, hasMore: members.length === limit, created: creates.length, updated, skipped, marked }
}

const PAGE_LIMIT = 250   // 페이지당 회원 수(작게 유지해 타임아웃 회피 — update 왕복이 병목)

// POST /api/makeshop/sync-members?mode=all|new&page=N — 한 페이지 처리. 클라이언트가 page 반복.
export async function POST(req: Request) {
  if (!makeshopConfigured()) {
    return NextResponse.json({ ok: false, error: 'not_configured', hint: 'Vercel 환경변수 설정 후 재배포하세요.' }, { status: 503 })
  }
  const sp = new URL(req.url).searchParams
  const mode = sp.get('mode') === 'new' ? 'new' : 'all'
  const page = Math.max(1, Number(sp.get('page')) || 1)
  try {
    const r = await syncMembersPage(mode, page, PAGE_LIMIT)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}

export { PAGE_LIMIT }
