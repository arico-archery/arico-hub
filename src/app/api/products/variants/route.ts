import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { groupCodeOf, buildVariantGroup, buildSibuyaGroup, buildFivicsGroup, fivicsBaseName, sibuyaBaseName, type RawVariant } from '@/lib/variants'

const VARIANT_SELECT = {
  id: true, name: true, brand: true, productCode: true, supplierCode: true,
  costPrice: true, salePriceJpy: true, unit: true, optionSize: true, optionColor: true,
  supplier: { select: { currency: true, taxRate: true, discount: true } },
} as const

// GET /api/products/variants?productId=123
// 같은 베이스 제품의 옵션 변형 목록을 반환.
// - JVD: 상품코드 접두부(- 앞)로 그룹 + 옵션 축 파싱 → { base, axes, variants }
// - SHIBUYA(SBY-): 베이스명으로 그룹 + 옵션필드(사이즈/색상) 축 → { base, axes, variants }
// - 그 외/변형 없음: 빈 배열 → 클라이언트는 자유입력
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const productId = Number(searchParams.get('productId'))
  if (!productId) return NextResponse.json({ variants: [] })

  const target = await prisma.product.findUnique({
    where: { id: productId },
    select: { supplierCode: true, name: true, productCode: true, optionSize: true, optionColor: true, variantParent: true },
  })
  if (!target) return NextResponse.json({ variants: [] })

  // JVD: 코드 접두부 그룹
  if (target.supplierCode === 'JVD') {
    const base = groupCodeOf('JVD', target.productCode)
    if (base === target.productCode) return genericGroup(target)   // 접미부 없는 단품 → 범용 폴백
    const rows = await prisma.product.findMany({
      where: { supplierCode: 'JVD', productCode: { startsWith: base + '-' } },
      select: VARIANT_SELECT,
    })
    if (rows.length < 2) return genericGroup(target)   // 전용 그룹이 안 잡히면 범용 폴백
    const group = buildVariantGroup(rows as RawVariant[])
    return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
  }

  // SHIBUYA: SBY- 세트(옵션필드 보유)를 베이스명으로 그룹
  if (target.supplierCode === 'SHIBUYA' && target.productCode.startsWith('SBY-')) {
    const base = sibuyaBaseName(target.name, target.optionSize, target.optionColor)
    const namePrefix = (target.name || '').trim().split(/\s+/)[0] || ''
    const candidates = await prisma.product.findMany({
      where: { supplierCode: 'SHIBUYA', productCode: { startsWith: 'SBY-' }, name: { startsWith: namePrefix, mode: 'insensitive' } },
      select: VARIANT_SELECT,
    })
    const rows = candidates.filter(c => sibuyaBaseName(c.name, c.optionSize, c.optionColor) === base)
    if (rows.length < 2) return genericGroup(target)   // 전용 그룹이 안 잡히면 범용 폴백
    const group = buildSibuyaGroup(rows as RawVariant[])
    return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
  }

  // FIVICS: 이름 접미부(옵션)를 뗀 베이스명으로 형제 변형을 묶는다 (숨긴 base 제외).
  if (target.supplierCode === 'FIVICS') {
    // 대상이 부모(변형으로 분리된 기본코드 — 카탈로그가 여기 연결된 경우)면
    // 코드 접두부로 자식 변형을 모아 돌려준다. 예: TPROS → TPROS300~TPROS1200(스파인 축)
    if (target.variantParent) {
      const kids = await prisma.product.findMany({
        where: { supplierCode: 'FIVICS', variantParent: false, productCode: { startsWith: target.productCode } },
        select: VARIANT_SELECT,
      })
      if (kids.length >= 2) {
        const group = buildFivicsGroup(kids as RawVariant[])
        return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
      }
      // 자식이 없으면 아래 이름 기반 그룹핑으로 폴백
    }
    const base = fivicsBaseName(target.name, target.optionSize)
    const candidates = await prisma.product.findMany({
      where: { supplierCode: 'FIVICS', variantParent: false, name: { startsWith: base } },
      select: VARIANT_SELECT,
    })
    const rows = candidates.filter(c => fivicsBaseName(c.name, c.optionSize) === base)
    if (rows.length < 2) return genericGroup(target)   // 전용 그룹이 안 잡히면 범용 폴백
    const group = buildFivicsGroup(rows as RawVariant[])
    return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
  }

  return genericGroup(target)
}

// ── 범용 폴백 ────────────────────────────────────────
// 위 3개 분기(JVD/SHIBUYA SBY-/FIVICS)에 걸리지 않는 경우를 위한 이름 기반 그룹.
// 두 가지 상황을 함께 해결한다:
//   ① SHIBUYA 웹크롤 상품(코드 0000…/0100…) — 옵션 필드가 비어 있지만, 같은 이름의 SBY- 세트에
//      색상·방향별 상품이 존재한다(스핀윙 베인 45mm = SBY-2428~2445 의 RH/LH × 9색).
//   ② MK·KOREA·ANGEL·WJ 등 분기가 아예 없던 공급사 — 옵션이 optionSize/optionColor 에 들어 있다.
// 기준은 「옵션값을 뗀 이름(베이스명)이 같은 같은 공급사 상품」. 옵션을 가진 것만 후보로 삼는다.
async function genericGroup(target: { supplierCode: string; name: string; optionSize: string; optionColor: string }) {
  const base = sibuyaBaseName(target.name, target.optionSize, target.optionColor).trim()
  if (base.length < 4) return NextResponse.json({ variants: [] })
  // 첫 단어로 1차 후보를 좁힌 뒤 베이스명 정밀 비교 (표기 흔들림은 정규화로 흡수)
  const prefix = base.split(/[\s　]+/)[0] || ''
  if (prefix.length < 2) return NextResponse.json({ variants: [] })
  const norm = (s: string) => s.normalize('NFKC').replace(/[\s　（）()]/g, '').toLowerCase()
  const baseKey = norm(base)

  const rows = await prisma.product.findMany({
    where: {
      supplierCode: target.supplierCode,
      name: { startsWith: prefix, mode: 'insensitive' },
      // 옵션이 있는 것만 = 변형으로 쓸 수 있는 것
      OR: [{ optionSize: { not: '' } }, { optionColor: { not: '' } }],
    },
    select: VARIANT_SELECT,
    take: 400,
  })
  const kin = rows.filter(r => norm(sibuyaBaseName(r.name, r.optionSize, r.optionColor)) === baseKey)
  if (kin.length < 2) return NextResponse.json({ variants: [] })
  const group = buildSibuyaGroup(kin as RawVariant[])
  return NextResponse.json({ base: group.base, axes: group.axes, variants: group.variants })
}
