// 비밀번호 해시 (Node 전용 — 라우트 핸들러에서만 사용)
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = (stored || '').split(':')
  if (!salt || !hash) return false
  const h = scryptSync(password, salt, 64)
  const hb = Buffer.from(hash, 'hex')
  return h.length === hb.length && timingSafeEqual(h, hb)
}
