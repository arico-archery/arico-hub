// Smaregi(スマレジ) 플랫폼 API 클라이언트.
// 스마레지 = ARICO 상품·옵션·재고의 마스터 소스. MakeShop 온라인 주문도 스마레지에 유입됨.
// 인증 = OAuth2 client_credentials. 비밀값은 Vercel 환경변수에만:
//   SMAREGI_CONTRACT_ID / SMAREGI_CLIENT_ID / SMAREGI_CLIENT_SECRET  (+ 선택 SMAREGI_ENV=dev|prod)
// 토큰: POST {ID_BASE}/app/{계약ID}/token (Basic 인증), 1시간 유효 → 메모리 캐시.
// API: {API_BASE}/{계약ID}/pos/... (Bearer 토큰).

const CONTRACT = process.env.SMAREGI_CONTRACT_ID || ''
const CLIENT_ID = process.env.SMAREGI_CLIENT_ID || ''
const CLIENT_SECRET = process.env.SMAREGI_CLIENT_SECRET || ''
const IS_DEV = process.env.SMAREGI_ENV === 'dev'   // 미설정=본번(prod)
const ID_BASE = IS_DEV ? 'https://id.smaregi.dev' : 'https://id.smaregi.jp'
const API_BASE = IS_DEV ? 'https://api.smaregi.dev' : 'https://api.smaregi.jp'

// 요청 스코프(자체앱에 부여돼 있어야 함). 없는 스코프는 토큰발급 시 에러.
export const SMAREGI_SCOPES = 'pos.products:read pos.stock:read pos.transactions:read'

export function smaregiConfigured(): boolean {
  return !!(CONTRACT && CLIENT_ID && CLIENT_SECRET)
}

export class SmaregiError extends Error {
  detail?: unknown
  constructor(message: string, detail?: unknown) { super(message); this.name = 'SmaregiError'; this.detail = detail }
}

// ── 토큰(캐시) ─────────────────────────────────────────────
let tokenCache = { token: '', exp: 0 }
async function getToken(scope = SMAREGI_SCOPES): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
  let res: Response
  try {
    res = await fetch(`${ID_BASE}/app/${CONTRACT}/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
    })
  } catch (e) { throw new SmaregiError('token_fetch_failed', String(e)) }
  const txt = await res.text()
  if (!res.ok) throw new SmaregiError(`token_http_${res.status}`, txt.slice(0, 400))
  let j: { access_token?: string; expires_in?: number }
  try { j = JSON.parse(txt) } catch { throw new SmaregiError('token_parse_failed', txt.slice(0, 200)) }
  if (!j.access_token) throw new SmaregiError('token_missing', txt.slice(0, 200))
  tokenCache = { token: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 }
  return tokenCache.token
}

// ── 공용 GET ───────────────────────────────────────────────
export async function smaregiGet<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T> {
  if (!smaregiConfigured()) throw new SmaregiError('not_configured')
  const token = await getToken()
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : ''
  let res: Response
  try {
    res = await fetch(`${API_BASE}/${CONTRACT}${path}${qs}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  } catch (e) { throw new SmaregiError('api_fetch_failed', String(e)) }
  const txt = await res.text()
  if (!res.ok) throw new SmaregiError(`http_${res.status}`, txt.slice(0, 400))
  try { return JSON.parse(txt) as T } catch { throw new SmaregiError('parse_failed', txt.slice(0, 200)) }
}

// ── 상품 (pos.products:read) ───────────────────────────────
// systemCode 대응: 스마레지 productCode ↔ MakeShop 商品番号 매핑은 착수 시 확정.
export type SmaregiProduct = {
  productId: string; productCode: string; productName: string
  price?: string; cost?: string; groupCode?: string; categoryId?: string
  [k: string]: unknown
}
export async function getProductsPage(page = 1, limit = 100): Promise<SmaregiProduct[]> {
  return smaregiGet<SmaregiProduct[]>('/pos/products', { limit, page })
}

// ── 부문(部門/카테고리) (pos.products:read) ────────────────
export type SmaregiCategory = { categoryId: string; categoryName: string; [k: string]: unknown }
export async function getAllCategories(): Promise<SmaregiCategory[]> {
  const out: SmaregiCategory[] = []
  for (let page = 1; page <= 50; page++) {
    const chunk = await smaregiGet<SmaregiCategory[]>('/pos/categories', { limit: 100, page })
    out.push(...chunk)
    if (chunk.length < 100) break
  }
  return out
}

// ── 재고 (pos.stock:read) ──────────────────────────────────
export type SmaregiStock = {
  productId: string; storeId?: string; stockAmount?: string; layawayStockAmount?: string
  [k: string]: unknown
}
export async function getStockPage(page = 1, limit = 100): Promise<SmaregiStock[]> {
  return smaregiGet<SmaregiStock[]>('/pos/stock', { limit, page })
}
