import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET ?? ''
  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token, secret)

  if (!session) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('from', req.nextUrl.pathname)
    return NextResponse.redirect(url)
  }
  // /admin/* 은 슈퍼어드민만
  if (req.nextUrl.pathname.startsWith('/admin') && session.role !== 'super_admin') {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  // 로그인/회원가입·인증 API·정적자산 제외한 모든 경로 보호
  matcher: [
    '/((?!login|signup|api/auth|api/health|_next/static|_next/image|favicon.ico|manual/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
}
