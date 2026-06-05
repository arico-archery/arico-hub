import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { SUPER_ADMINS } from '@/auth'

async function requireSuper() {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) return { ok: false as const, status: 401 }
  const me = await prisma.user.findUnique({ where: { email } })
  if (!me || me.role !== 'super_admin') return { ok: false as const, status: 403 }
  return { ok: true as const, email }
}

// 사용자 목록 (슈퍼어드민)
export async function GET() {
  const g = await requireSuper()
  if (!g.ok) return NextResponse.json({ error: 'forbidden' }, { status: g.status })
  const users = await prisma.user.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] })
  return NextResponse.json({ users })
}

// 역할/상태 변경 (슈퍼어드민)
export async function PATCH(req: Request) {
  const g = await requireSuper()
  if (!g.ok) return NextResponse.json({ error: 'forbidden' }, { status: g.status })

  const body = await req.json() as { id: number; role?: string; status?: string }
  const target = await prisma.user.findUnique({ where: { id: body.id } })
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 고정 슈퍼어드민(sms/sbs)은 강등·비활성 불가 (잠금 방지)
  if (SUPER_ADMINS.includes(target.email.toLowerCase())) {
    return NextResponse.json({ error: 'protected_super_admin' }, { status: 400 })
  }

  const data: { role?: string; status?: string } = {}
  if (body.role === 'admin' || body.role === 'super_admin') data.role = body.role
  if (body.status === 'active' || body.status === 'disabled') data.status = body.status

  const updated = await prisma.user.update({ where: { id: body.id }, data })
  return NextResponse.json({ ok: true, user: updated })
}
