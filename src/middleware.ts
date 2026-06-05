import NextAuth from 'next-auth'
import authConfig from '@/auth.config'

// Edge 안전 인스턴스(Prisma 미사용) — JWT 세션만 검증
const { auth } = NextAuth(authConfig)

export default auth((req) => {
  if (!req.auth) {
    return Response.redirect(new URL('/login', req.nextUrl.origin))
  }
  // /admin/* 은 슈퍼어드민만
  if (req.nextUrl.pathname.startsWith('/admin') && req.auth.user?.role !== 'super_admin') {
    return Response.redirect(new URL('/', req.nextUrl.origin))
  }
})

export const config = {
  // 로그인·인증 API·정적자산 제외한 모든 경로 보호
  matcher: [
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|manual/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
}
