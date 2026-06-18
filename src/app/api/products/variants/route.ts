import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { groupCodeOf, buildVariantGroup, type RawVariant } from '@/lib/variants'

const VARIANT_SELECT = {
  id: true, name: true, brand: true, productCode: true, supplierCode: true,
  costPrice: true, salePriceJpy: true, unit: true, optionSize: true, optionColor: true,
  supplier: { select: { currency: true, taxRate: true, discount: true } },
} as const

// 상품명에서 옵션값(사이즈/색상)을 제거해 베이스명을 만든다. (SIBUYA 등 옵션필드 보유 공급사용)
function baseName(name: string, size: string, color: string): string {
  let s = name || ''
  if (size) s = s.split(size).join('')
  if (color) s = s.split(color).join('')
  return s.replace(/\s+/g, ' ').trim()
}

// GET /api/products/variants?productId=123
// 같은 베이스 제품의 옵션 변형 목록을 반환.
// - JVD: 상품코드 접두부(- 앞)로 그룹 + 옵션 축 파싱 → { base, axes, variants }
// - SIBUYA 등 옵션필드 보유: 베이스명으로 그룹 (2~60개) → { base, variants }
// - 그 외/변형 없음: 빈 배열 → 클라이언트는 자유입력
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const productId = Number(searchParams.get('productId'))
  if (!productId) return NextResponse.json({ variants: [] })

  const target = await prisma.product.findUnique({
    where: { id: productId },
    select: { supplierCode: true, name: true, productCode: true, optionSize: true, optionColor: true },
  })
  if (!target) return NextResponse.json({ variants: [] })

  // JVD: 코드 접두부 그룹
  if (target.supplierCode === 'JVD') {
    const base = groupCodeOf('JVD', target.productCode)
    if (base === target.productCode) return NextResponse.json({ variants: [] }) // 접미부 없는 단품
    const rows = await prisma.product.findMany({
      where: { supplierCode: 'JVD', productCode: { startsWith: base + '-' } },
      select: VARIANT_SELECT,
    })
    if (rows.length < 2) return NextResponse.json({ variants: [] })
    const group = buildVariantGroup(rows as RawVariant[])
    return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
  }

  // SIBUYA 등: 옵션 필드 기반 베이스명 그룹
  if (!target.optionSize && !target.optionColor) {
    return NextResponse.json({ variants: [] })
  }
  const base = baseName(target.name, target.optionSize, target.optionColor)
  const namePrefix = (target.name || '').trim().split(/\s+/)[0] || ''
  const candidates = await prisma.product.findMany({
    where: {
      supplierCode: target.supplierCode,
      name: { startsWith: namePrefix, mode: 'insensitive' },
      OR: [{ optionSize: { not: '' } }, { optionColor: { not: '' } }],
    },
    select: VARIANT_SELECT,
  })
  const variants = candidates
    .filter(c => baseName(c.name, c.optionSize, c.optionColor) === base)
    .sort((a, b) => (a.optionSize + a.optionColor).localeCompare(b.optionSize + b.optionColor))
  if (variants.length < 2 || variants.length > 60) {
    return NextResponse.json({ variants: [] })
  }
  return NextResponse.json({ variants, base })
}
