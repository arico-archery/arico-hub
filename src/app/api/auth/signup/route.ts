import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE, ALLOWED_DOMAIN, SUPER_ADMINS } from '@/lib/session'

// 회원가입 — @arico.group 이메일만 등록 허용
export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })

  let email = '', password = '', name = ''
  try {
    const b = await req.json()
    email = String(b?.email ?? '').trim().toLowerCase()
    password = String(b?.password ?? '')
    name = String(b?.name ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  if (!email.endsWith('@' + ALLOWED_DOMAIN)) {
    return NextResponse.json({ error: 'domain' }, { status: 403 }) // @arico.group 만
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'weak_password' }, { status: 400 })
  }

  const exists = await prisma.user.findUnique({ where: { email } })
  if (exists) return NextResponse.json({ error: 'exists' }, { status: 409 })

  const role = SUPER_ADMINS.includes(email) ? 'super_admin' : 'admin'
  const user = await prisma.user.create({
    data: { email, name, passwordHash: hashPassword(password), role, lastLogin: new Date() },
  })

  const token = await createSession(secret, { email: user.email, role: user.role })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE,
  })
  return res
}
