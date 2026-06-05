import type { NextAuthConfig } from 'next-auth'
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id'

// Edge(미들웨어)에서도 안전하게 쓰는 기본 설정 — Prisma 등 Node 전용 모듈 import 금지.
// 환경변수 자동 인식: AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET / _ISSUER, AUTH_SECRET
export default {
  providers: [
    MicrosoftEntraID({
      authorization: { params: { scope: 'openid profile email' } },
    }),
  ],
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    // 토큰의 role/status 를 세션에 전달 (DB 미사용 — Edge 안전)
    session({ session, token }) {
      if (session.user) {
        if (token.role) session.user.role = token.role as string
        if (token.status) session.user.status = token.status as string
      }
      return session
    },
  },
} satisfies NextAuthConfig
