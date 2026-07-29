import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST /api/smaregi/to-product — 스마레지 재고 항목을 주문 라인으로 쓸 수 있게 Product 로 변환.
//
// 왜 필요한가: 주문 품목(OrderItem)은 productId(공급사 Product)가 필수인데 스마레지는
// 별도 테이블이라 그대로는 주문에 못 넣는다. 스마레지 코드로 ETC 공급사 Product 를
// 찾고, 없으면 만든다(같은 코드는 재사용). 스마레지 원가는 이미 JPY 최종가라 그대로 저장.
//
// 반환 product 는 신규주문 화면의 Product 타입 형태(supplier 통화·세율·할인 포함).
export async function POST(req: Request) {
  const { productId } = (await req.json()) as { productId?: string }
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const sm = await prisma.smaregiProduct.findUnique({ where: { productId } })
  if (!sm) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const code = sm.productCode || `SM-${sm.productId}`
  const include = { supplier: { select: { currency: true, taxRate: true, discount: true } } }

  let product = await prisma.product.findFirst({ where: { supplierCode: 'ETC', productCode: code }, include })
  if (!product) {
    product = await prisma.product.create({
      data: {
        supplierCode: 'ETC',
        productCode: code,
        barcode: code,                 // 스마레지 재고 연결 키
        name: sm.name.trim() || code,
        brand: '',
        costPrice: sm.cost,            // 스마레지 원가(JPY 최종가) — ETC는 환산·할인 없음
        salePriceJpy: sm.price,
        optionSize: sm.size,
        optionColor: sm.color,
        unit: '',
      },
      include,
    })
  }

  return NextResponse.json({ product })
}
