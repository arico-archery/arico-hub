import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Suppliers (8개 — src/lib/utils.ts SUPPLIER_LIST/SUPPLIER_COLORS 와 일치)
  const suppliers = [
    { code: 'JVD', name: 'JVD Archery', currency: 'USD', priceType: 'COST', taxRate: 0, discount: 0, color: '#6366f1' },
    { code: 'MK', name: 'MK Korea', currency: 'USD', priceType: 'COST', taxRate: 0, discount: 0, color: '#8b5cf6' },
    { code: 'FIVICS', name: 'FIVICS', currency: 'USD', priceType: 'COST', taxRate: 0, discount: 0, color: '#3b82f6' },
    // SHIBUYA: discount는 calcCostJpy에서 브랜드별 처리 (SHIBUYA=62%, 타브랜드=65%)
    { code: 'SHIBUYA', name: 'SHIBUYA', currency: 'JPY', priceType: 'RETAIL', taxRate: 0.1, discount: 0, color: '#0ea5e9' },
    { code: 'KOREA', name: 'Korea Archery', currency: 'JPY', priceType: 'COST', taxRate: 0.1, discount: 0, color: '#10b981' },
    { code: 'ANGEL', name: 'Angel', currency: 'JPY', priceType: 'COST', taxRate: 0, discount: 0.6, color: '#f59e0b' },
    { code: 'WJ', name: 'WJ Sports', currency: 'JPY', priceType: 'COST', taxRate: 0, discount: 0, color: '#f97316' },
    // ETC: 기타 브랜드 수동 입력 (JPY 원가 직접 입력)
    { code: 'ETC', name: '기타 브랜드', currency: 'JPY', priceType: 'COST', taxRate: 0, discount: 0, color: '#64748b' },
  ]

  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { code: s.code },
      update: s,
      create: s,
    })
  }

  // Exchange rates (JPY 기준)
  const rates = [
    { currency: 'USD', rateToJpy: 155.0 },
    { currency: 'JPY', rateToJpy: 1.0 },
    { currency: 'EUR', rateToJpy: 168.0 },
  ]

  for (const r of rates) {
    await prisma.exchangeRate.upsert({
      where: { currency: r.currency },
      update: { rateToJpy: r.rateToJpy },
      create: r,
    })
  }

  // Sample customers
  const customers = [
    { code: 'C001', name: '김철수', company: '서울 양궁클럽', email: 'kim@example.com', phone: '010-1234-5678' },
    { code: 'C002', name: '이영희', company: '부산 체육센터', email: 'lee@example.com', phone: '010-9876-5432' },
    { code: 'C003', name: '박민준', company: '대구 아처리', email: 'park@example.com', phone: '010-5555-1234' },
  ]

  for (const c of customers) {
    await prisma.customer.upsert({
      where: { code: c.code },
      update: c,
      create: c,
    })
  }

  // Sample products
  const sampleProducts = [
    { supplierCode: 'JVD', productCode: 'WIN-WIAWIA1800', name: 'WIN&WIN Wiawis A1800 Riser', brand: 'WIN&WIN', category: 'bows', costPrice: 850, msrp: 1200, unit: '1' },
    { supplierCode: 'JVD', productCode: 'HOYT-FORMULA-RES', name: 'Hoyt Formula Res Riser', brand: 'HOYT', category: 'bows', costPrice: 1200, msrp: 1800, unit: '1' },
    { supplierCode: 'MK', productCode: 'MK-ARCHERY-HX', name: 'MK Korea HX Handle', brand: 'MK', category: 'bows', costPrice: 450, msrp: 680, unit: '1' },
    { supplierCode: 'FIVICS', productCode: 'FIV-SIGHT-DX', name: 'FIVICS Titan DX Sight', brand: 'FIVICS', category: 'sights', costPrice: 320, msrp: 520, unit: '1' },
    { supplierCode: 'SHIBUYA', productCode: 'SHB-ULTIMA-RC1', name: 'SHIBUYA Ultima RC DX Sight', brand: 'SHIBUYA', category: 'sights', costPrice: 68000, msrp: 68000, unit: '1' },
    { supplierCode: 'ANGEL', productCode: 'ANG-QUIVER-001', name: 'Angel Hip Quiver Premium', brand: 'ANGEL', category: 'accessories', costPrice: 8000, msrp: 12000, unit: '1' },
  ]

  for (const p of sampleProducts) {
    await prisma.product.upsert({
      where: { supplierCode_productCode: { supplierCode: p.supplierCode, productCode: p.productCode } },
      update: p,
      create: p,
    })
  }

  console.log('Seed completed')
}

main().catch(console.error).finally(() => prisma.$disconnect())
