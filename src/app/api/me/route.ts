import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/get-session'

// 본인 프로필 조회
export async function GET() {
  const s = await getSession()
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email: s.email } })
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  })
}
