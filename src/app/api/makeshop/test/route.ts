import { NextResponse } from 'next/server'
import { getShop, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

// GET /api/makeshop/test — MakeShop API 연결 확인 (getShop, 읽기전용).
// 로그인 필요(미들웨어 보호). 환경변수 미설정 시 503으로 안내.
export async function GET() {
  if (!makeshopConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'not_configured',
      hint: 'Vercel 환경변수 MAKESHOP_GQL_ENDPOINT / MAKESHOP_API_TOKEN / MAKESHOP_API_KEY 설정 후 재배포하세요.',
    }, { status: 503 })
  }
  try {
    const shop = await getShop()
    return NextResponse.json({ ok: true, shop })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
