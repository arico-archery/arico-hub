import { prisma } from './prisma'
import { getProductsPage, getStockPage, getAllCategories } from './smaregi'

const LIMIT = 100

// 부문(카테고리) 맵 캐시 — categoryId → categoryName. 동기화 중 재사용(10분 TTL).
let catCache: { map: Map<string, string>; exp: number } = { map: new Map(), exp: 0 }
async function categoryMap(): Promise<Map<string, string>> {
  if (catCache.map.size && Date.now() < catCache.exp) return catCache.map
  const cats = await getAllCategories()
  const map = new Map<string, string>()
  for (const c of cats) map.set(String(c.categoryId), String(c.categoryName ?? ''))
  catCache = { map, exp: Date.now() + 10 * 60 * 1000 }
  return map
}

// 상품 1페이지 → 벌크 upsert(1 쿼리). 부문명 포함. 반환: {count, done}
export async function syncProductsPage(page: number): Promise<{ count: number; done: boolean }> {
  const products = await getProductsPage(page, LIMIT)
  if (products.length) {
    const cats = await categoryMap()
    const now = new Date()
    const params: unknown[] = []
    const rows: string[] = []
    let i = 1
    for (const p of products) {
      const category = cats.get(String((p as Record<string, unknown>).categoryId ?? '')) ?? ''
      params.push(
        String(p.productId), String(p.productCode ?? ''), String(p.productName ?? ''), category,
        String(p.size ?? ''), String(p.color ?? ''),
        Math.round(Number(p.price) || 0), Math.round(Number(p.cost) || 0),
        String((p as Record<string, unknown>).displayFlag ?? ''), now, now,
      )
      rows.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`)
    }
    const sql = `INSERT INTO smaregi_product ("productId","productCode","name","category","size","color","price","cost","displayFlag","syncedAt","updatedAt") VALUES ${rows.join(',')} ON CONFLICT ("productId") DO UPDATE SET "productCode"=EXCLUDED."productCode","name"=EXCLUDED."name","category"=EXCLUDED."category","size"=EXCLUDED."size","color"=EXCLUDED."color","price"=EXCLUDED."price","cost"=EXCLUDED."cost","displayFlag"=EXCLUDED."displayFlag","syncedAt"=EXCLUDED."syncedAt","updatedAt"=EXCLUDED."updatedAt"`
    await prisma.$executeRawUnsafe(sql, ...params)
  }
  return { count: products.length, done: products.length < LIMIT }
}

// 재고 합산 전 초기화 (합계·도쿄·아이치)
export async function resetStock(): Promise<void> {
  await prisma.smaregiProduct.updateMany({ data: { stock: 0, stockTokyo: 0, stockAichi: 0, storeStock: '' } })
}

// 재고 1페이지 → 상품별 stock 증분(벌크 UPDATE 1 쿼리). 매장별(1=아이치, 2=도쿄) 분리. 반환: {count, done}
export async function syncStockPage(page: number): Promise<{ count: number; done: boolean }> {
  const stock = await getStockPage(page, LIMIT)
  // 페이지 내 productId별 (합계, 도쿄=store2, 아이치=store1) 누적
  const byId = new Map<string, { total: number; tokyo: number; aichi: number }>()
  for (const s of stock) {
    const pid = String(s.productId)
    // 取り置き(layaway)는 이미 손님에게 예약된 몫이라 쓸 수 없다 → 가용 재고에서 뺀다.
    // 예: 도쿄 재고 3 · 取り置き 2 → 실제로 쓸 수 있는 건 1.
    const amt = Math.round(Number(s.stockAmount) || 0) - Math.round(Number(s.layawayStockAmount) || 0)
    const sid = String(s.storeId ?? '')
    const cur = byId.get(pid) || { total: 0, tokyo: 0, aichi: 0 }
    cur.total += amt
    if (sid === '2') cur.tokyo += amt
    else if (sid === '1') cur.aichi += amt
    byId.set(pid, cur)
  }
  const entries = [...byId.entries()]
  if (entries.length) {
    const params: unknown[] = []
    const rows: string[] = []
    let i = 1
    for (const [pid, v] of entries) {
      params.push(pid, v.total, v.tokyo, v.aichi)
      rows.push(`($${i++}::text,$${i++}::int,$${i++}::int,$${i++}::int)`)
    }
    const sql = `UPDATE smaregi_product AS sp SET stock = sp.stock + v.total, "stockTokyo" = sp."stockTokyo" + v.tokyo, "stockAichi" = sp."stockAichi" + v.aichi FROM (VALUES ${rows.join(',')}) AS v(pid, total, tokyo, aichi) WHERE sp."productId" = v.pid`
    await prisma.$executeRawUnsafe(sql, ...params)
  }
  return { count: stock.length, done: stock.length < LIMIT }
}
