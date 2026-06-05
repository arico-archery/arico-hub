// 로컬 SQLite(dev.db) → Postgres(현재 DATABASE_URL) 1회 데이터 이전 도구.
// 사용:  node scripts/migrate-sqlite-to-postgres.mjs
//   - .env 의 DATABASE_URL/DIRECT_URL 이 Postgres 를 가리켜야 함
//   - 먼저 `npm run db:push` 로 Postgres 에 테이블이 생성돼 있어야 함
//   - 기존 SQLite 파일 경로는 LEGACY_SQLITE_PATH (기본 ./prisma/dev.db)
import Database from 'better-sqlite3'
import { PrismaClient } from '@prisma/client'

const SQLITE = process.env.LEGACY_SQLITE_PATH || './prisma/dev.db'
const db = new Database(SQLITE, { readonly: true })
const prisma = new PrismaClient()

const toDate = (v) => (v === null || v === undefined ? null : new Date(Number(v)))
const conv = (row, dateFields, colMap) => {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    const field = colMap?.[k] ?? k
    out[field] = dateFields.includes(field) ? toDate(v) : v
  }
  return out
}

// [SQLite 테이블, Prisma delegate, DateTime 필드, (snake→camel) 컬럼맵]
const TABLES = [
  ['Supplier', 'supplier', ['createdAt', 'updatedAt']],
  ['ExchangeRate', 'exchangeRate', ['updatedAt']],
  ['Setting', 'setting', ['updatedAt']],
  ['Customer', 'customer', ['createdAt', 'updatedAt']],
  ['Product', 'product', ['scrapedAt', 'createdAt', 'updatedAt']],
  ['PurchaseOrder', 'purchaseOrder', ['orderDate', 'expectedDate', 'receivedDate', 'confirmedDate', 'paidDate', 'createdAt', 'updatedAt']],
  ['PurchaseOrderItem', 'purchaseOrderItem', ['createdAt']],
  ['Order', 'order', ['orderDate', 'dueDate', 'delayNotifyDate', 'completedAt', 'paymentDate', 'shippingDate', 'deliveryDate', 'createdAt', 'updatedAt']],
  ['OrderItem', 'orderItem', ['createdAt']],
  ['AricoCatalog', 'aricoCatalog', ['createdAt', 'updatedAt'], {
    product_code: 'productCode', price_jpy: 'priceJpy', price_jpy_notax: 'priceJpyNotax',
    msrp_jpy: 'msrpJpy', image_url_1: 'imageUrl1', image_url_2: 'imageUrl2', image_url_3: 'imageUrl3',
    scraped_at: 'scrapedAt', supplier_product_id: 'supplierProductId', created_at: 'createdAt', updated_at: 'updatedAt',
  }],
  ['StockLevel', 'stockLevel', ['updatedAt']],
]

const SQLITE_NAME = { AricoCatalog: 'arico_catalog' }
const BATCH = 1000

async function main() {
  for (const [model, delegate, dateFields, colMap] of TABLES) {
    const tbl = SQLITE_NAME[model] ?? model
    let rows
    try {
      rows = db.prepare(`SELECT * FROM "${tbl}"`).all()
    } catch (e) {
      console.log(`[skip] ${model}: ${e.message}`)
      continue
    }
    if (!rows.length) { console.log(`[--] ${model}: 0`); continue }
    const data = rows.map(r => conv(r, dateFields, colMap))
    let inserted = 0
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH)
      const res = await prisma[delegate].createMany({ data: chunk, skipDuplicates: true })
      inserted += res.count
    }
    console.log(`[OK] ${model}: ${inserted}/${rows.length}`)
  }
  console.log('이전 완료. (sequence 보정이 필요하면 Postgres에서 setval 실행)')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect(); db.close() })
