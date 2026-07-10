import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE, SUPER_ADMINS } from '@/lib/session'
import { hashToken } from '@/lib/email'

// 이메일 인증 링크 착지점: 토큰 확인 → 계정 활성화 → 세션 발급 후 홈으로 리다이렉트.
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET
  const url = new URL(req.url)
  const origin = process.env.APP_URL || url.origin
  const token = url.searchParams.get('token') || ''
  if (!secret || !token) return NextResponse.redirect(`${origin}/login?verify=failed`)

  const user = await prisma.user.findFirst({
    where: { verifyToken: hashToken(token), status: 'pending' },
  })
  if (!user || !user.verifyTokenExp || user.verifyTokenExp.getTime() < Date.now()) {
    return NextResponse.redirect(`${origin}/login?verify=failed`)
  }

  let role = user.role
  if (SUPER_ADMINS.includes(user.email) && role !== 'super_admin') role = 'super_admin'
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'active', verifyToken: '', verifyTokenExp: null, role, lastLogin: new Date() },
  })

  const sessionToken = await createSession(secret, { email: user.email, role })
  const res = NextResponse.redirect(`${origin}/?verified=1`)
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE,
  })
  return res
}
