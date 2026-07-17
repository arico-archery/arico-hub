import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { makeshopQuery, makeshopConfigured } from '@/lib/makeshop'

export const maxDuration = 60

// 자사몰 회원에 성·이름이 따로 있는지 확인하는 일회성 진단. HMAC 보호. 읽기 전용.
// GraphQL 스키마를 모르니 후보 필드를 하나씩 넣어보고 통하는 것을 찾는다(기존 basket-probe와 같은 방식).
const CANDIDATES = [
  'hname1', 'hname2', 'name1', 'name2', 'firstName', 'lastName',
  'familyName', 'givenName', 'sei', 'mei', 'nameSei', 'nameMei',
  'nameKana1', 'nameKana2', 'hnameKana1', 'hnameKana2',
  'haddress3', 'haddressDetail', 'hbanchi',   // 번지(주소 상세)도 함께 확인
]

export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET || ''
  if (!secret) return NextResponse.json({ error: 'server_not_configured' }, { status: 500 })
  const token = new URL(req.url).searchParams.get('token') || ''
  const expected = crypto.createHmac('sha256', secret).update('import-orders').digest('hex')
  const ok = token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })

  const ask = async (fields: string) => {
    const d = await makeshopQuery<{ searchMember?: { members?: Record<string, unknown>[] } }>(
      `query searchMember($input: SearchMemberRequest!){ searchMember(input: $input){ members { ${fields} } } }`,
      { input: { page: 1, limit: 1 } },
    )
    return d.searchMember?.members?.[0]
  }

  const supported: Record<string, unknown> = {}
  const unsupported: string[] = []
  for (const f of CANDIDATES) {
    try {
      const row = await ask(`memberId ${f}`)
      supported[f] = row?.[f] ?? null
    } catch (e) {
      unsupported.push(f + ' — ' + String(e).slice(0, 50))
    }
  }
  let base: unknown = null
  try { base = await ask('memberId name nameKana haddressAddr haddress1 haddress2') } catch { /* noop */ }
  return NextResponse.json({ ok: true, 지금쓰는값: base, 존재하는필드: supported, 없는필드: unsupported })
}
