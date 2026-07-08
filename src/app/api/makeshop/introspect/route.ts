import { NextResponse } from 'next/server'
import { makeshopQuery, makeshopConfigured, MakeshopError } from '@/lib/makeshop'

// GET /api/makeshop/introspect?kw=order,member,payment
// GraphQL introspection으로 실제 타입/필드명을 캐낸다(문서에 없는 주문품목·입금상태·회원 필드 확인용).
type GqlType = { kind: string; name: string | null; ofType?: GqlType | null }
type GqlField = { name: string; type: GqlType }
type GqlTypeDef = { name: string; kind: string; fields: GqlField[] | null }

function typeStr(t: GqlType | null | undefined): string {
  if (!t) return '?'
  if (t.name) return t.name + (t.kind === 'ENUM' ? '(enum)' : '')
  if (t.ofType) {
    const inner = typeStr(t.ofType)
    return t.kind === 'LIST' ? `[${inner}]` : t.kind === 'NON_NULL' ? `${inner}!` : inner
  }
  return t.kind
}

const INTROSPECT = `query {
  __schema { types {
    name kind
    fields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  } }
}`

export async function GET(req: Request) {
  if (!makeshopConfigured()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const kwParam = new URL(req.url).searchParams.get('kw') || 'order,member,payment,delivery,product,address,point,ship,price'
  const kws = kwParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  try {
    const data = await makeshopQuery<{ __schema?: { types?: GqlTypeDef[] } }>(INTROSPECT)
    const types = data.__schema?.types ?? []
    const out: Record<string, string[]> = {}
    for (const t of types) {
      if (!t.fields || !t.name || t.name.startsWith('__')) continue
      const lower = t.name.toLowerCase()
      if (!kws.some(k => lower.includes(k))) continue
      out[t.name] = t.fields.map(f => `${f.name}: ${typeStr(f.type)}`)
    }
    return NextResponse.json({ ok: true, typeCount: Object.keys(out).length, types: out })
  } catch (e) {
    const err = e instanceof MakeshopError ? { error: e.message, detail: e.detail } : { error: String(e) }
    return NextResponse.json({ ok: false, ...err }, { status: 502 })
  }
}
