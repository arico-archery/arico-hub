-- 상품 검색(ILIKE) 가속용 트라이그램(pg_trgm) 인덱스.
-- Prisma 스키마가 관리하지 않는 raw 인덱스이므로, `prisma db push`로 사라졌다면 다시 실행할 것.
-- 적용: psql 또는  node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{for(const s of require('fs').readFileSync('prisma/trgm-indexes.sql','utf8').split(';').map(x=>x.trim()).filter(Boolean))await p.$executeRawUnsafe(s);console.log('done');process.exit(0)})()"

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS product_name_trgm     ON "Product" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_brand_trgm    ON "Product" USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_code_trgm     ON "Product" USING gin ("productCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_optsize_trgm  ON "Product" USING gin ("optionSize" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS product_optcolor_trgm ON "Product" USING gin ("optionColor" gin_trgm_ops);
