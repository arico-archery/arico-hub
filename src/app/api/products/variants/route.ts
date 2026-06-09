import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 상품명에서 옵션값(사이즈/색상)을 제거해 베이스명을 만든다.
// 같은 베이스명 + 같은 공급사 = 옵션 변형 그룹.
//   예) "FIVICS ARGON X ハンドル 25" RH グリーン" (size=RH, color=グリーン)
//       → 베이스 "FIVICS ARGON X ハンドル 25\""
function baseName(name: string, size: string, color: string): string {
  let s = name || ''
  if (size) s = s.split(size).join('')
  if (color) s = s.split(color).join('')
  return s.replace(/\s+/g, ' ').trim()
}

// GET /api/products/variants?productId=123
// 같은 베이스 제품의 옵션 변형 목록을 반환.
// 옵션 필드가 없는 상품(JVD 등 이름에만 옵션)이나 변형이 없거나(1개)
// 너무 많으면(>60, 예: Mathews 양궁처럼 색상×강도×길이 폭발) 빈 배열 → 클라이언트는 자유입력.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const productId = Number(searchParams.get('productId'))
  if (!productId) return NextResponse.json({ variants: [] })

  const target = await prisma.product.findUnique({
    where: { id: productId },
    select: { supplierCode: true, name: true, optionSize: true, optionColor: true },
  })
  if (!target || (!target.optionSize && !target.optionColor)) {
    return NextResponse.json({ variants: [] })
  }

  const base = baseName(target.name, target.optionSize, target.optionColor)

  // 변형들은 이름 첫 단어(보통 브랜드)가 공통이므로 그걸로 후보를 좁힌다 (성능).
  // 앞 N자 고정 prefix는 공백 표기 불일치(예: "FIVICS "/"FIVICS  ")로 변형을 놓치므로
  // 첫 단어만 쓰고, 정확한 그룹핑은 공백 정규화된 baseName 비교로 한다.
  const namePrefix = (target.name || '').trim().split(/\s+/)[0] || ''

  const candidates = await prisma.product.findMany({
    where: {
      supplierCode: target.supplierCode,
      name: { startsWith: namePrefix, mode: 'insensitive' },
      OR: [{ optionSize: { not: '' } }, { optionColor: { not: '' } }],
    },
    select: {
      id: true, name: true, brand: true, productCode: true, supplierCode: true,
      costPrice: true, salePriceJpy: true, unit: true, optionSize: true, optionColor: true,
      supplier: { select: { currency: true, taxRate: true, discount: true } },
    },
  })

  const variants = candidates
    .filter(c => baseName(c.name, c.optionSize, c.optionColor) === base)
    .sort((a, b) => (a.optionSize + a.optionColor).localeCompare(b.optionSize + b.optionColor))

  if (variants.length < 2 || variants.length > 60) {
    return NextResponse.json({ variants: [] })
  }
  return NextResponse.json({ variants, base })
}
