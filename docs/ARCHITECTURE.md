# 아키텍처 / Architecture

ARICO Distribution Hub의 데이터 모델·업무 흐름·핵심 모듈 요약. (개발자용)

## 1. 업무 흐름 (핵심)

```
고객 주문 접수 → 발주서 발행 → 재고확인·제조사 청구서 → 매입 지급 → 입고 → 고객 발송 → 고객 입금
```

- **주문(Order)**: 고객이 주문. 품목(OrderItem)의 `procureStatus` = `needed`(미발주) → `ordered`(발주완료) → `received`(입고완료).
- **발주(PurchaseOrder)**: 백오더의 미발주 품목을 공급사별로 묶어 생성. 상태 = `ordered` → `confirmed`(재고확인) → `paid`(매입지급) → `partial`/`received`(입고).
- **재고확인**: 제조사가 회신한 재고에 맞춰 품목별 `confirmedQty` 입력. `confirmedQty < quantity`면 잔여분이 자동으로 백오더(`needed`)로 분리 복귀.
- **매입지급**: 제조사에 지급 기록(PO `paymentStatus=paid`).
- **입고**: `receivedQty` 입력 → 재고(StockLevel) 증가, 연결 OrderItem `received`.
- **발송/입금**: 주문의 `shippingDate`/`paymentStatus`로 관리. 입고된 품목만 부분발송 가능.

## 2. 데이터 모델 (`prisma/schema.prisma`)

| 모델 | 설명 | 주요 관계 |
|------|------|-----------|
| `Supplier` | 공급처 8개 (코드·통화·掛率) | → Product, PurchaseOrder |
| `Product` | 공급사 상품 (원가·판매가·옵션) | ← Supplier |
| `ExchangeRate` | 통화별 환율(→JPY) | — |
| `Customer` | 거래처(고객) | → Order |
| `Order` / `OrderItem` | 주문 / 주문품목(`procureStatus`) | ← Customer, → Product, PO |
| `PurchaseOrder` / `PurchaseOrderItem` | 발주서 / 발주품목(`confirmedQty`,`receivedQty`) | ← Supplier |
| `StockLevel` | 상품 재고 | ← Product |
| `AricoCatalog` | ARICO 자사몰 카탈로그 ↔ 공급사 상품 매칭 | → Product(`supplierProductId`, onDelete:SetNull) |
| `Setting` | key-value 설정(발행처·계좌·번역 API 키 등) | — |

## 3. 원가 계산 — `src/lib/utils.ts` `calcCostJpy()`

| 공급처 | 계산 |
|--------|------|
| JVD·MK·FIVICS (USD) | `costPrice × 환율 × 1.1` (운송+관세 10%) |
| SIBUYA | `희망소매가 × 0.62`(자체) / `0.65`(기타) |
| ANGEL | `税抜 × 0.70`(퀴버·벨트네임 등) / `0.60` |
| KOREA | 세금 제거 후 掛率 |
| ETC(기타) | 입력 엔화 원가 그대로 |

## 4. 핵심 모듈

- **인증**: `src/middleware.ts`(전 경로 보호), `src/lib/auth.ts`(HMAC 서명/검증, Edge 호환), `src/app/api/auth/*`, `src/app/login`.
- **i18n**: `src/lib/i18n.tsx`(컨텍스트·Alt+L 토글), `src/lib/translations.ts`(ko/ja). `useT()`/`useI18n()`.
- **문서 발급**: `src/app/documents/[type]/[id]/`(청구서/견적서/발주서), `src/lib/documents.ts`(일·한·영 양식 문자열). 발행처·계좌는 Setting에서.
- **자동매칭**: `src/app/api/auto-match/route.ts`. 브랜드→공급사 매핑 + 이름 정규화(카타카나→영어) + 유사도(포함·키워드·LCS) + LH/RH 가드 + 공급처 우선순위·SIBUYA 폴백 + 중복 원가 비교. 임계값 0.65, 수작업 매칭 보호.
- **임포트**: `src/app/api/import/route.ts`(CSV/XLSX 파싱, 공급사별 컬럼 매핑).
- **대시보드/분석**: `src/app/api/dashboard`(기간 토글 month/6m/all + 운영현황 + 매입지급대기 + 입고지연), `src/app/api/analytics`(기간별 매출·공급사/브랜드별·미수금).

## 5. 마이그레이션 메모

- DB는 **SQLite → PostgreSQL** 로 이전됨(2026-06). 스키마 변경 최소(provider만), 데이터는 `scripts/migrate-sqlite-to-postgres.mjs`로 이전.
- 스키마 동기화는 `prisma db push` 사용(migrations 폴더 미사용). 팀 협업 강화 시 `prisma migrate`로 전환 가능.

## 6. 알려진 개선점

- `src/app/api/backorders/create-po/route.ts`: PO 원가를 `product.costPrice × 환율`로 재계산 → 주문 시 확정된 `OrderItem.costPriceJpy`(및 `calcCostJpy`의 ×1.1)와 불일치 가능. 발주 생성 시 주문 확정 원가를 사용하도록 수정 권장.
