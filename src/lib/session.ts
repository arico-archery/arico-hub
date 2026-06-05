// 세션 쿠키(HMAC 서명) — Edge(미들웨어)/Node 양쪽에서 Web Crypto만 사용.
// 페이로드에 email + role 을 담아 미들웨어에서 DB 없이 /admin 가드 가능.

export const SESSION_COOKIE = 'arico_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7일(초)
export const ALLOWED_DOMAIN = 'arico.group'
export const SUPER_ADMINS = ['sms@arico.group', 'sbs@arico.group']

export type SessionPayload = { email: string; role: string; t: number }

const encoder = new TextEncoder()

function bytesToB64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function strToB64url(str: string): string {
  return bytesToB64url(encoder.encode(str))
}
function b64urlToStr(b: string): string {
  const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4))
  const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
  return bytesToB64url(sig)
}

export async function createSession(secret: string, p: { email: string; role: string }): Promise<string> {
  const body = strToB64url(JSON.stringify({ email: p.email, role: p.role, t: Date.now() }))
  return `${body}.${await hmac(secret, body)}`
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token || !secret) return null
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if ((await hmac(secret, body)) !== sig) return null
  try {
    const p = JSON.parse(b64urlToStr(body)) as SessionPayload
    if (!p.t || Date.now() - p.t > SESSION_MAX_AGE * 1000) return null
    return p
  } catch {
    return null
  }
}
