import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/password'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE, SUPER_ADMINS } from '@/lib/session'

// 로그인 (이메일 + 비밀번호)
export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })

  let email = '', password = ''
  try {
    const b = await req.json()
    email = String(b?.email ?? '').trim().toLowerCase()
    password = String(b?.password ?? '')
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'invalid' }, { status: 401 })
  }
  if (user.status === 'pending') {
    return NextResponse.json({ error: 'unverified' }, { status: 403 }) // 이메일 인증 미완료
  }
  if (user.status === 'disabled') {
    return NextResponse.json({ error: 'disabled' }, { status: 403 })
  }

  // 슈퍼어드민 보정
  let role = user.role
  if (SUPER_ADMINS.includes(email) && role !== 'super_admin') role = 'super_admin'
  await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date(), ...(role !== user.role ? { role } : {}) } })

  const token = await createSession(secret, { email: user.email, role })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE,
  })
  return res
}
