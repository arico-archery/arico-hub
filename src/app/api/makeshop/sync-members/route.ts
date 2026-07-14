import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { searchMemberDetailedPage, memberPostal, memberAddress, makeshopConfigured, MakeshopError } from '@/lib/makeshop'
import { maxCustomerSeq } from '@/lib/seq'

export const maxDuration = 60

// 회원 한 페이지 동기화 (POST·cron 공용). mode=new면 기존 갱신 생략.
export async function syncMembersPage(mode: 'all' | 'new', page: number, limit: number) {
  const members = await searchMemberDetailedPage(page, limit)
  const memberIds = members.map(m => m.memberId).filter(Boolean)
  const existing = new Map(
    (await prisma.customer.findMany({ where: { externalMemberId: { in: memberIds } }, select: { id: true, externalMemberId: true } })).map(c => [c.externalMemberId, c.id]),
  )
  let seq = await maxCustomerSeq()
  let skipped = 0
  const creates: Record<string, string>[] = []
  const updates: { id: number; data: Record<string, string> }[] = []
  for (const m of members) {
    if (!m.memberId) continue
    const id = existing.get(m.memberId)
    if (id && mode === 'new') { skipped++; continue }
    const data: Record<string, string> = {}
    if (m.name) data.name = m.name
    if (m.nameKana) data.nameKana = m.nameKana
    if (m.email) data.email = m.email
    if (m.tel) data.phone = m.tel
    const addr = memberAddress(m); if (addr) data.address = addr
    const pc = memberPostal(m); if (pc) data.postalCode = pc
    if (id) {
      if (Object.keys(data).length) updates.push({ id, data })
    } else {
      seq += 1
      creates.push({ code: `C${String(seq).padStart(3, '0')}`, name: data.name || m.memberId, nameKana: data.nameKana || '', externalMemberId: m.memberId, email: data.email || '', phone: data.phone || '', address: data.address || '', postalCode: data.postalCode || '' })
    }
  }
  if (creates.length) await prisma.customer.createMany({ data: creates as unknown as NonNullable<Parameters<typeof prisma.customer.createMany>[0]>['data'] })
  let updated = 0
  const CONC = 10
  for (let i = 0; i < updates.length; i += CONC) {
    const r = await Promise.allSettled(updates.slice(i, i + CONC).map(u => prisma.customer.update({ where: { id: u.id }, data: u.data })))
    updated += r.filter(x => x.status === 'fulfilled').length
  }
  return { page, count: members.length, hasMore: members.length === limit, created: creates.length, updated, skipped }
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
