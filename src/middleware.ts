import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'

// 로그인/인증 API/정적 파일 외 모든 경로를 보호한다.
export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? ''
  // 인증 미설정(로컬에서 AUTH_SECRET/APP_PASSWORD 없음)이면 통과 — 개발 편의
  if (!secret || !process.env.APP_PASSWORD) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const ok = await verifySessionToken(token, secret)
  if (ok) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('from', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  // 로그인 페이지·인증 API·정적자산·이미지 확장자는 미들웨어 제외
  matcher: [
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
}
