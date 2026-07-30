import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { matchByCatalog, isCostSane } from '@/lib/catalog-match'

// POST /api/smaregi/to-product — 스마레지 재고 항목을 주문 라인으로 쓸 수 있게 Product 로 변환.
//
// 왜 필요한가: 주문 품목(OrderItem)은 productId(공급사 Product)가 필수인데 스마레지는
// 별도 테이블이라 그대로는 주문에 못 넣는다. 스마레지 코드로 Product 를 찾고, 없으면 만든다.
//
// 공급사는 카탈로그를 통해 찾는다(matchByCatalog). 스마레지에는 공급사 칸이 없어서
// 예전에는 무조건 ETC(기타)로 넣었는데, 그러면 공급사별 분석에서 ETC 가 최대 항목이 되고
// 원가도 비어 마진이 100%로 잡혔다. 카탈로그가 이미 공급사·원가를 알고 있으니 그걸 쓴다.
// 못 찾으면 ETC + 스마레지 원가로 둔다(기존 동작).
//
// 반환 product 는 신규주문 화면의 Product 타입 형태(supplier 통화·세율·할인 포함).
export async function POST(req: Request) {
  const { productId } = (await req.json()) as { productId?: string }
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const sm = await prisma.smaregiProduct.findUnique({ where: { productId } })
  if (!sm) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const code = sm.productCode || `SM-${sm.productId}`
  const include = { supplier: { select: { currency: true, taxRate: true, discount: true } } }

  // 이미 만들어 둔 것이 있으면 재사용 — 공급사가 무엇이든(ETC 였다가 옮겨졌을 수도 있다)
  let product = await prisma.product.findFirst({ where: { barcode: code }, include })
    ?? await prisma.product.findFirst({ where: { supplierCode: 'ETC', productCode: code }, include })

  if (!product) {
    // 카탈로그를 통해 진짜 공급사·원가를 찾는다. 못 찾으면 ETC + 스마레지 원가.
    const m = await matchByCatalog(sm.name)
    const supplierCode = m?.supplierCode ?? 'ETC'
    // ⚠️ costPrice 는 공급사 통화 단위다(JVD/MK/FIVICS=USD). 카탈로그에서 찾았으면 그 원본 값을,
    // 못 찾았으면 스마레지 원가(JPY)를 ETC 에 넣는다. 섞으면 $24,244 로 오해석돼 폭발한다.
    //
    // 원가는 판매가와 비교해 말이 되는지 확인한 뒤에만 쓴다. 이름으로 이었기 때문에
    // 「1枚」이 「50枚入」 카탈로그에 붙는 일이 있다(실측: 판매¥52 vs 원가¥1,645).
    // 어긋나면 공급사만 반영하고 원가는 비워 둔다 — 틀린 원가보다 빈 원가가 낫다.
    const costPrice = m && isCostSane(m.costJpy, sm.price) ? m.costPrice : (m ? 0 : sm.cost)
    product = await prisma.product.create({
      data: {
        supplierCode,
        productCode: code,
        barcode: code,                 // 스마레지 재고 연결 키
        name: sm.name.trim() || code,
        brand: m?.brand ?? '',
        costPrice,
        salePriceJpy: sm.price,
        optionSize: sm.size,
        optionColor: sm.color,
        unit: '',
      },
      include,
    }).catch(async (e: { code?: string }) => {
      // (공급사, 상품코드) 유니크 충돌 = 그 공급사에 같은 코드가 이미 있다 → 그것을 쓴다
      if (e?.code === 'P2002') return prisma.product.findFirst({ where: { supplierCode, productCode: code }, include })
      throw e
    })
    if (!product) return NextResponse.json({ error: 'create_failed' }, { status: 500 })
  }

  return NextResponse.json({ product })
}
