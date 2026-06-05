import NextAuth from 'next-auth'
import authConfig from '@/auth.config'
import { prisma } from '@/lib/prisma'

// 슈퍼 어드민 (고정)
export const SUPER_ADMINS = ['sms@arico.group', 'sbs@arico.group']
// 허용 도메인 (MS365 @arico.group 조직 계정만)
export const ALLOWED_DOMAIN = 'arico.group'

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // 로그인 허용 여부 + 자동 관리자 등록(upsert)
    async signIn({ profile, user }) {
      const email = String(
        profile?.email || (profile as { preferred_username?: string })?.preferred_username || user?.email || '',
      ).toLowerCase()
      if (!email.endsWith('@' + ALLOWED_DOMAIN)) return false // 도메인 제한

      const isSuper = SUPER_ADMINS.includes(email)
      const name = String(profile?.name || user?.name || '')
      const dbUser = await prisma.user.upsert({
        where: { email },
        update: {
          lastLogin: new Date(),
          ...(name ? { name } : {}),
          ...(isSuper ? { role: 'super_admin' } : {}), // 슈퍼어드민은 항상 보정
        },
        create: { email, name, role: isSuper ? 'super_admin' : 'admin', lastLogin: new Date() },
      })
      if (dbUser.status === 'disabled') return false // 비활성 계정 차단
      return true
    },
    // 토큰에 DB 역할/상태 동기화 (Node 런타임)
    async jwt({ token }) {
      const email = token.email?.toLowerCase()
      if (email) {
        const u = await prisma.user.findUnique({ where: { email } })
        if (u) {
          token.role = u.role
          token.status = u.status
          token.uid = u.id
          token.name = u.name || token.name
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as string) ?? 'admin'
        session.user.status = (token.status as string) ?? 'active'
      }
      return session
    },
  },
})
