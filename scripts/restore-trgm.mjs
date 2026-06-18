// 트라이그램(pg_trgm) 인덱스 복구 — `prisma db push` 후 매번 실행할 것.
// db push는 스키마에 없는 raw 인덱스를 드롭하므로 검색 속도가 느려진다.
// 사용: node scripts/restore-trgm.mjs   (또는 npm run db:trgm)
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const stmts = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE INDEX IF NOT EXISTS product_name_trgm ON "Product" USING gin (name gin_trgm_ops)',
  'CREATE INDEX IF NOT EXISTS product_brand_trgm ON "Product" USING gin (brand gin_trgm_ops)',
  'CREATE INDEX IF NOT EXISTS product_code_trgm ON "Product" USING gin ("productCode" gin_trgm_ops)',
  'CREATE INDEX IF NOT EXISTS product_optsize_trgm ON "Product" USING gin ("optionSize" gin_trgm_ops)',
  'CREATE INDEX IF NOT EXISTS product_optcolor_trgm ON "Product" USING gin ("optionColor" gin_trgm_ops)',
]
for (const s of stmts) await p.$executeRawUnsafe(s)
console.log('✅ trigram indexes restored')
process.exit(0)
