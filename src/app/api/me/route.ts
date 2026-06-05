import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

// 본인 프로필 조회
export async function GET() {
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({ where: { email } })
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
