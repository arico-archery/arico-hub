import { prisma } from './prisma'
import { getProductsPage, getStockPage } from './smaregi'

const LIMIT = 100
const CONC = 10

// 상품 1페이지 → SmaregiProduct upsert. 반환: {count, done}
export async function syncProductsPage(page: number): Promise<{ count: number; done: boolean }> {
  const products = await getProductsPage(page, LIMIT)
  for (let i = 0; i < products.length; i += CONC) {
    await Promise.allSettled(products.slice(i, i + CONC).map(p => {
      const data = {
        productCode: String(p.productCode ?? ''), name: String(p.productName ?? ''),
        size: String(p.size ?? ''), color: String(p.color ?? ''),
        price: Math.round(Number(p.price) || 0), cost: Math.round(Number(p.cost) || 0),
        displayFlag: String((p as Record<string, unknown>).displayFlag ?? ''),
        syncedAt: new Date(),
      }
      return prisma.smaregiProduct.upsert({ where: { productId: String(p.productId) }, update: data, create: { productId: String(p.productId), ...data } })
    }))
  }
  return { count: products.length, done: products.length < LIMIT }
}

// 재고 합산 전 초기화
export async function resetStock(): Promise<void> {
  await prisma.smaregiProduct.updateMany({ data: { stock: 0, storeStock: '' } })
}

// 재고 1페이지 → 상품별 stock 증분. 반환: {count, done}
export async function syncStockPage(page: number): Promise<{ count: number; done: boolean }> {
  const stock = await getStockPage(page, LIMIT)
  for (let i = 0; i < stock.length; i += CONC) {
    await Promise.allSettled(stock.slice(i, i + CONC).map(s => {
      const amt = Math.round(Number(s.stockAmount) || 0)
      return prisma.smaregiProduct.updateMany({ where: { productId: String(s.productId) }, data: { stock: { increment: amt } } })
    }))
  }
  return { count: stock.length, done: stock.length < LIMIT }
}
