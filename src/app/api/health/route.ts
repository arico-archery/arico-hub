import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { APP_VERSION } from '@/lib/version'

// 헬스체크 / keep-warm 엔드포인트.
// 외부 업타임 핑(또는 Vercel Cron)이 주기적으로 호출하면 함수+DB 연결이 식지 않아
// 콜드스타트 체감을 줄인다. 인증 불필요(미들웨어 matcher에서 제외 필요).
export const dynamic = 'force-dynamic'

export async function GET() {
  const t0 = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, db: 'up', version: APP_VERSION, ms: Date.now() - t0 })
  } catch {
    return NextResponse.json({ ok: false, db: 'down', version: APP_VERSION, ms: Date.now() - t0 }, { status: 503 })
  }
}
