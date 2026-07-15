import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { groupCodeOf, buildVariantGroup, buildSibuyaGroup, buildFivicsGroup, sibuyaBaseName, type RawVariant } from '@/lib/variants'

const VARIANT_SELECT = {
  id: true, name: true, brand: true, productCode: true, supplierCode: true,
  costPrice: true, salePriceJpy: true, unit: true, optionSize: true, optionColor: true,
  supplier: { select: { currency: true, taxRate: true, discount: true } },
} as const

// GET /api/products/variants?productId=123
// 같은 베이스 제품의 옵션 변형 목록을 반환.
// - JVD: 상품코드 접두부(- 앞)로 그룹 + 옵션 축 파싱 → { base, axes, variants }
// - SIBUYA(SBY-): 베이스명으로 그룹 + 옵션필드(사이즈/색상) 축 → { base, axes, variants }
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

  // SIBUYA: SBY- 세트(옵션필드 보유)를 베이스명으로 그룹
  if (target.supplierCode === 'SIBUYA' && target.productCode.startsWith('SBY-')) {
    const base = sibuyaBaseName(target.name, target.optionSize, target.optionColor)
    const namePrefix = (target.name || '').trim().split(/\s+/)[0] || ''
    const candidates = await prisma.product.findMany({
      where: { supplierCode: 'SIBUYA', productCode: { startsWith: 'SBY-' }, name: { startsWith: namePrefix, mode: 'insensitive' } },
      select: VARIANT_SELECT,
    })
    const rows = candidates.filter(c => sibuyaBaseName(c.name, c.optionSize, c.optionColor) === base)
    if (rows.length < 2) return NextResponse.json({ variants: [] })
    const group = buildSibuyaGroup(rows as RawVariant[])
    return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
  }

  // FIVICS: 이름이 같은 변형 SKU들을 단일 옵션 축으로 그룹 (숨긴 base 제외)
  if (target.supplierCode === 'FIVICS') {
    const rows = await prisma.product.findMany({
      where: { supplierCode: 'FIVICS', name: target.name, variantParent: false },
      select: VARIANT_SELECT,
    })
    if (rows.length < 2) return NextResponse.json({ variants: [] })
    const group = buildFivicsGroup(rows as RawVariant[])
    return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
  }

  return NextResponse.json({ variants: [] })
}
