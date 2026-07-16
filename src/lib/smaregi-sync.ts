import { prisma } from './prisma'
import { getProductsPage, getStockPage } from './smaregi'

const LIMIT = 100

// 상품 1페이지 → 벌크 upsert(1 쿼리). 반환: {count, done}
export async function syncProductsPage(page: number): Promise<{ count: number; done: boolean }> {
  const products = await getProductsPage(page, LIMIT)
  if (products.length) {
    const now = new Date()
    const params: unknown[] = []
    const rows: string[] = []
    let i = 1
    for (const p of products) {
      params.push(
        String(p.productId), String(p.productCode ?? ''), String(p.productName ?? ''),
        String(p.size ?? ''), String(p.color ?? ''),
        Math.round(Number(p.price) || 0), Math.round(Number(p.cost) || 0),
        String((p as Record<string, unknown>).displayFlag ?? ''), now, now,
      )
      rows.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`)
    }
    // stock/storeStock는 갱신하지 않음(재고 단계에서 처리). 신규행은 default 0.
    const sql = `INSERT INTO smaregi_product ("productId","productCode","name","size","color","price","cost","displayFlag","syncedAt","updatedAt") VALUES ${rows.join(',')} ON CONFLICT ("productId") DO UPDATE SET "productCode"=EXCLUDED."productCode","name"=EXCLUDED."name","size"=EXCLUDED."size","color"=EXCLUDED."color","price"=EXCLUDED."price","cost"=EXCLUDED."cost","displayFlag"=EXCLUDED."displayFlag","syncedAt"=EXCLUDED."syncedAt","updatedAt"=EXCLUDED."updatedAt"`
    await prisma.$executeRawUnsafe(sql, ...params)
  }
  return { count: products.length, done: products.length < LIMIT }
}

// 재고 합산 전 초기화
export async function resetStock(): Promise<void> {
  await prisma.smaregiProduct.updateMany({ data: { stock: 0, storeStock: '' } })
}

// 재고 1페이지 → 상품별 stock 증분(벌크 UPDATE 1 쿼리). 반환: {count, done}
export async function syncStockPage(page: number): Promise<{ count: number; done: boolean }> {
  const stock = await getStockPage(page, LIMIT)
  // 페이지 내에서 productId별 합산(점포별 레코드 합침)
  const byId = new Map<string, number>()
  for (const s of stock) {
    const pid = String(s.productId)
    byId.set(pid, (byId.get(pid) || 0) + Math.round(Number(s.stockAmount) || 0))
  }
  const entries = [...byId.entries()]
  if (entries.length) {
    const params: unknown[] = []
    const rows: string[] = []
    let i = 1
    for (const [pid, delta] of entries) { params.push(pid, delta); rows.push(`($${i++}::text,$${i++}::int)`) }
    const sql = `UPDATE smaregi_product AS sp SET stock = sp.stock + v.delta FROM (VALUES ${rows.join(',')}) AS v(pid, delta) WHERE sp."productId" = v.pid`
    await prisma.$executeRawUnsafe(sql, ...params)
  }
  return { count: stock.length, done: stock.length < LIMIT }
}
