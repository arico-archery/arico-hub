import { NextResponse } from 'next/server'
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth'

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET
  const expected = process.env.APP_PASSWORD
  if (!secret || !expected) {
    return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  }

  let password = ''
  try {
    const body = await req.json()
    password = String(body?.password ?? '')
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'invalid' }, { status: 401 })
  }

  const token = await createSessionToken(secret)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
