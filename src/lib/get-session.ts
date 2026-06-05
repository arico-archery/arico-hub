// 서버(라우트/RSC)에서 현재 세션 조회
import { cookies } from 'next/headers'
import { verifySession, SESSION_COOKIE, type SessionPayload } from './session'

export async function getSession(): Promise<SessionPayload | null> {
  const c = await cookies()
  const token = c.get(SESSION_COOKIE)?.value
  return verifySession(token, process.env.AUTH_SECRET || '')
}
