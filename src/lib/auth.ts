// 경량 세션 인증 — NextAuth 없이 HMAC 서명 쿠키 사용.
// Edge(미들웨어)와 Node(라우트) 양쪽에서 동작하도록 Web Crypto(crypto.subtle)만 사용.

export const SESSION_COOKIE = 'arico_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7일(초)

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
  return base64url(sig)
}

/** 세션 토큰 생성: `<발급시각ms>.<HMAC>` */
export async function createSessionToken(secret: string): Promise<string> {
  const payload = String(Date.now())
  return `${payload}.${await sign(secret, payload)}`
}

/** 세션 토큰 검증 (서명 일치 + 만료 확인) */
export async function verifySessionToken(token: string | undefined, secret: string): Promise<boolean> {
  if (!token || !secret) return false
  const dot = token.indexOf('.')
  if (dot < 0) return false
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = await sign(secret, payload)
  if (sig !== expected) return false
  const issued = Number(payload)
  if (!Number.isFinite(issued)) return false
  if (Date.now() - issued > SESSION_MAX_AGE * 1000) return false
  return true
}
