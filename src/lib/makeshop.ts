// MakeShop Shop Admin API (GraphQL) 클라이언트.
// 자격증명은 환경변수에서만 읽는다(코드/깃에 넣지 않음).
//   MAKESHOP_GQL_ENDPOINT (기본 https://app-api.makeshop.jp/v1/graphql)
//   MAKESHOP_API_TOKEN    (액세스 토큰. 'Bearer ' 없이 토큰만 넣으면 됨)
//   MAKESHOP_API_KEY      (x-api-key)
// x-timestamp(1시간 유효)는 요청마다 자동 생성.

const ENDPOINT = process.env.MAKESHOP_GQL_ENDPOINT || 'https://app-api.makeshop.jp/v1/graphql'
const TOKEN = process.env.MAKESHOP_API_TOKEN || ''
const API_KEY = process.env.MAKESHOP_API_KEY || ''

export function makeshopConfigured(): boolean {
  return Boolean(ENDPOINT && TOKEN && API_KEY)
}

export class MakeshopError extends Error {
  detail?: unknown
  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'MakeshopError'
    this.detail = detail
  }
}

type GqlResponse<T> = { data?: T; errors?: unknown }

// 임의 GraphQL 쿼리 실행. 실패 시 MakeshopError.
export async function makeshopQuery<T = unknown>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!makeshopConfigured()) throw new MakeshopError('not_configured')
  const authorization = TOKEN.startsWith('Bearer ') ? TOKEN : `Bearer ${TOKEN}`
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization,
        'x-api-key': API_KEY,
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables, operationName: null }),
      signal: AbortSignal.timeout(30000),
    })
  } catch (e) {
    throw new MakeshopError('network_error', String(e))
  }
  const text = await res.text()
  let json: GqlResponse<T>
  try { json = JSON.parse(text) as GqlResponse<T> } catch { throw new MakeshopError(`bad_response_${res.status}`, text.slice(0, 300)) }
  if (!res.ok) throw new MakeshopError(`http_${res.status}`, json)
  if (json.errors) throw new MakeshopError('graphql_error', json.errors)
  return json.data as T
}

// 연결 확인용: 상점 기본 정보
export type ShopInfo = { shopName: string; shopUrl: string; settingOriginalDomain: string; openCondition: string }
export async function getShop(): Promise<ShopInfo | null> {
  const data = await makeshopQuery<{ getShop?: { shop?: ShopInfo } }>(
    `query { getShop { shop { shopName shopUrl settingOriginalDomain openCondition } } }`,
  )
  return data.getShop?.shop ?? null
}
