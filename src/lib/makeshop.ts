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

// ── 상품 (searchProduct) ─────────────────────────────
// systemCode = 商品番号(12자리) → AricoCatalog.productCode 와 동일 키.
export type MakeshopProduct = { uid: string; systemCode: string; productName: string; sellPrice: number }

export async function searchProductPage(page: number, limit = 1000): Promise<MakeshopProduct[]> {
  const data = await makeshopQuery<{ searchProduct?: { products?: MakeshopProduct[] } }>(
    `query searchProduct($input: SearchProductRequest!){ searchProduct(input: $input){ products { uid systemCode productName sellPrice } } }`,
    { input: { page, limit } },
  )
  return data.searchProduct?.products ?? []
}

// 전 상품 페이지네이션 수집 (limit 미만이 오면 마지막 페이지).
export async function getAllProducts(limit = 1000, maxPages = 200): Promise<MakeshopProduct[]> {
  const out: MakeshopProduct[] = []
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await searchProductPage(page, limit)
    out.push(...chunk)
    if (chunk.length < limit) break
  }
  return out
}

// ── 회원 (searchMember) ─────────────────────────────
export type MakeshopMember = { groupId: string; groupName: string; memberId: string; name: string }
export async function searchMemberPage(page = 1, limit = 1000): Promise<MakeshopMember[]> {
  const data = await makeshopQuery<{ searchMember?: { members?: MakeshopMember[] } }>(
    `query searchMember($input: SearchMemberRequest!){ searchMember(input: $input){ members { groupId groupName memberId name } } }`,
    { input: { page, limit } },
  )
  return data.searchMember?.members ?? []
}

// 전 회원 수집 (memberId→name 매핑용). 검증된 최소 필드만 사용.
export async function getAllMembers(limit = 1000, maxPages = 100): Promise<MakeshopMember[]> {
  const out: MakeshopMember[] = []
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await searchMemberPage(page, limit)
    out.push(...chunk)
    if (chunk.length < limit) break
  }
  return out
}

// ── 주문 (searchOrder) ─────────────────────────────
// 날짜는 YYYYMMDDHHmmss (예: 20221230000000).
export type MakeshopOrder = { systemOrderNumber: string; displayOrderNumber: string; memberId: string; orderDate: string; sumPrice: number }
export async function searchOrderPage(startOrderDate: string, endOrderDate: string, page = 1, limit = 100): Promise<MakeshopOrder[]> {
  const data = await makeshopQuery<{ searchOrder?: { orders?: MakeshopOrder[] } }>(
    `query searchOrder($input: SearchOrderRequest!){ searchOrder(input: $input){ orders { systemOrderNumber displayOrderNumber memberId orderDate sumPrice } } }`,
    { input: { startOrderDate, endOrderDate, page, limit } },
  )
  return data.searchOrder?.orders ?? []
}

// YYYYMMDDHHmmss
export function fmtOrderDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ── 주문 상세 (searchOrder, 품목·입금·수령인 포함) ─────────────────
// 실제 스키마: 주문 품목은 deliveryInfos[].basketInfos[] 에 있음.
export type MakeshopBasket = {
  productCode: string; variationCustomCode: string; janCode: string
  amount: number; price: number; productName: string
}
export type MakeshopDelivery = {
  deliveryStatus: string; shippingCharge: number
  slipNumber: string; deliveryDate: string; estimatedShipmentDate: string
  basketInfos: MakeshopBasket[]
}
export type MakeshopOrderDetail = {
  systemOrderNumber: string; displayOrderNumber: string; orderDate: string; memberId: string
  sumPrice: number; paymentStatusCode: string
  deliveryInfos: MakeshopDelivery[]
}

const ORDER_DETAIL_QUERY = `query searchOrder($input: SearchOrderRequest!){
  searchOrder(input: $input){
    orders {
      systemOrderNumber displayOrderNumber orderDate memberId sumPrice paymentStatusCode
      deliveryInfos {
        deliveryStatus shippingCharge slipNumber deliveryDate estimatedShipmentDate
        basketInfos { productCode variationCustomCode janCode amount price productName }
      }
    }
  }
}`

export async function searchOrdersDetailed(startOrderDate: string, endOrderDate: string, page = 1, limit = 1000): Promise<MakeshopOrderDetail[]> {
  const data = await makeshopQuery<{ searchOrder?: { orders?: MakeshopOrderDetail[] } }>(
    ORDER_DETAIL_QUERY, { input: { startOrderDate, endOrderDate, page, limit } },
  )
  return data.searchOrder?.orders ?? []
}

// 기간 내 전 주문 수집 (페이지네이션). limit 미만이 오면 마지막 페이지.
export async function getAllOrdersDetailed(startOrderDate: string, endOrderDate: string, limit = 1000, maxPages = 100): Promise<MakeshopOrderDetail[]> {
  const out: MakeshopOrderDetail[] = []
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await searchOrdersDetailed(startOrderDate, endOrderDate, page, limit)
    out.push(...chunk)
    if (chunk.length < limit) break
  }
  return out
}

// ── 회원 상세 (searchMember, 연락처·주소 포함) ─────────────────
export type MakeshopMemberDetail = {
  memberId: string; name: string; nameKana: string; email: string
  tel: string; etcphone: string; hpost: string; haddress1: string; haddressAddr: string; haddress2: string
}
const MEMBER_DETAIL_FIELDS = `memberId name nameKana email tel etcphone hpost haddress1 haddressAddr haddress2`

export async function searchMemberDetailedPage(page = 1, limit = 1000): Promise<MakeshopMemberDetail[]> {
  const data = await makeshopQuery<{ searchMember?: { members?: MakeshopMemberDetail[] } }>(
    `query searchMember($input: SearchMemberRequest!){ searchMember(input: $input){ members { ${MEMBER_DETAIL_FIELDS} } } }`,
    { input: { page, limit } },
  )
  return data.searchMember?.members ?? []
}

// 전 회원 상세 수집 (이메일·전화·주소 포함).
export async function getAllMembersDetailed(limit = 1000, maxPages = 100): Promise<MakeshopMemberDetail[]> {
  const out: MakeshopMemberDetail[] = []
  for (let page = 1; page <= maxPages; page++) {
    const chunk = await searchMemberDetailedPage(page, limit)
    out.push(...chunk)
    if (chunk.length < limit) break
  }
  return out
}

// 회원 우편번호(7자리) → 000-0000
export function memberPostal(m?: MakeshopMemberDetail | null): string {
  const z = (m?.hpost ?? '').replace(/[^0-9]/g, '')
  return z.length === 7 ? `${z.slice(0, 3)}-${z.slice(3)}` : z
}
// 회원 주소 = 도도부현 + 시구정촌
export function memberAddress(m?: MakeshopMemberDetail | null): string {
  return m ? [m.haddressAddr, m.haddress2].filter(Boolean).join(' ') : ''
}
