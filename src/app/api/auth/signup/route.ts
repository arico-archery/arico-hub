import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/password'
import { ALLOWED_DOMAIN, SUPER_ADMINS } from '@/lib/session'
import { makeVerifyToken, sendVerificationEmail, mailConfigured } from '@/lib/email'

// 회원가입 — @arico.group 이메일만. 즉시 로그인 없이 이메일 인증 후 활성화.
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
  // 이미 활성 계정이면 가입 불가. pending(미인증)이면 재발송 허용.
  if (exists && exists.status !== 'pending') {
    return NextResponse.json({ error: 'exists' }, { status: 409 })
  }

  const role = SUPER_ADMINS.includes(email) ? 'super_admin' : 'admin'
  const { raw, hash } = makeVerifyToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24시간

  if (exists) {
    // 미인증 재가입 → 비번/토큰 갱신 후 재발송
    await prisma.user.update({
      where: { id: exists.id },
      data: { name, passwordHash: hashPassword(password), role, verifyToken: hash, verifyTokenExp: expiresAt },
    })
  } else {
    await prisma.user.create({
      data: { email, name, passwordHash: hashPassword(password), role, status: 'pending', verifyToken: hash, verifyTokenExp: expiresAt },
    })
  }

  // 인증 링크 (배포 도메인 기준)
  const origin = process.env.APP_URL || req.headers.get('origin') || `https://${req.headers.get('host')}`
  const verifyUrl = `${origin}/api/auth/verify?token=${raw}`

  const sent = await sendVerificationEmail(email, verifyUrl, name)
  // 이메일 발송 미설정(부트스트랩)일 때만 링크를 응답으로 돌려줘 수동 인증 가능
  return NextResponse.json({ ok: true, pending: true, emailSent: sent, ...(mailConfigured() ? {} : { devLink: verifyUrl }) })
}
