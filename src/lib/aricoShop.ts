// ARICO 자사숍(arico-archery.com, MakeShop) 크롤 — 카탈로그 가져오기/새로고침용.
// 상품 페이지는 SSR HTML에 데이터가 있어 단순 fetch로 파싱 가능(헤드리스 불필요).

export const SHOP_BASE = 'https://www.arico-archery.com'
const LIST_PATH = '/view/category/all_items'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

export async function fetchShop(pathOrUrl: string): Promise<string> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : SHOP_BASE + pathOrUrl
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// 목록 페이지 HTML에서 상품코드(12자리) 열거
export function codesFromList(html: string): string[] {
  const m = html.match(/\/view\/item\/(\d{12})/g) || []
  return [...new Set(m.map(s => s.replace('/view/item/', '')))]
}

export const listPageUrl = (page: number) => `${LIST_PATH}?page=${page}`
export const itemUrl = (code: string) => `${SHOP_BASE}/view/item/${code}`

const toNum = (s: string) => Number((s || '').replace(/[^\d]/g, '')) || 0

export type ParsedItem = { name: string; priceJpy: number; msrpJpy: number; point: number; imageUrl1: string; url: string }

// 상품 상세 HTML 파싱 (item-title/item-price/item-point/fixed-price/이미지)
export function parseItem(html: string, code: string): ParsedItem | null {
  const nameM = html.match(/item-category-name">[\s\S]*?<\/p>\s*([^<]+)/)
  const name = nameM ? nameM[1].replace(/&#?\w+;/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if (!name) return null
  const priceM = html.match(/makeshop-item-price[^>]*>([\d,]+)<\/span>/)
  const msrpM  = html.match(/class="fixed-price">[\s\S]*?<span>[^\d]*([\d,]+)/)
  const pointM = html.match(/makeshop-item-point[^>]*>([\d,]+)<\/span>/)
  const imgM   = html.match(/https?:\/\/[^"' )]*itemimages[^"' )]+\.(?:jpg|jpeg|png|gif)/i)
  return {
    name,
    priceJpy: priceM ? toNum(priceM[1]) : 0,
    msrpJpy:  msrpM ? toNum(msrpM[1]) : 0,
    point:    pointM ? toNum(pointM[1]) : 0,
    imageUrl1: imgM ? imgM[0] : '',
    url: itemUrl(code),
  }
}
