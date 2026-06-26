# MakeShop 주문 연동 기획 (수신 전용 1단계)

> 상태: **대기 중 — MakeShop API Key 들어오면 착수.**
> 작성 2026-06-26. 역방향(송장·상태 push)은 나중, 이번 범위는 **주문 수신(pull)만.**

---

## 0. 결정 사항

- **수신(pull) 전용.** 주문을 arico-hub로 끌어오기만 한다. 송장번호·출하상태를 MakeShop으로 되돌리는 역방향 push는 **5단계(보류).**
- **"API 있다고 가정하고 진행."** 실제 Key가 없는 동안에는 **Mock 모드**(아래 시뮬 주문 fixture)로 빌드·검증하고, Key가 들어오면 환경변수만 꽂아 운영 전환.
- **매칭은 기존 수동매칭(`AricoCatalog.supplierProductId`)을 그대로 사용.** 새 매칭/정규화 로직은 넣지 않는다(사용자: "내가 수동으로 맞춰놨지만 부족해, 우선 놔둬").
- **마진 이상치는 가공·숨김 없이 그대로 노출**해서 정리 대상이 눈에 보이게 한다.

---

## 1. MakeShop API 사양 (확인됨)

정식 어드민 API = **GraphQL** (Shop Admin API).

**인증 헤더**
- `authorization: Bearer <token>` (영구 토큰 또는 SSO 임시 토큰)
- `x-api-key: <key>` (앱 승인 후 발급)
- `x-timestamp: <unix>` (1시간 유효)
- `content-type: application/json`
- 요청 5MB 초과 거부

**조회 — `searchOrder(SearchOrderRequest!)`**
페이지네이션(`page`/`limit`/`searchedCount`). 응답 필드:
- 식별: `systemOrderNumber`(P1868…), `displayOrderNumber`, `orderDate`
- 금액: `sumPrice`, `taxRate`, `paymentStatus`(仮売上/入金), `couponDiscount`
- 배송: `deliveryStatus`, `shippingCharge`, `desiredDeliveryDate`
- 품목: `productCode`, `variationCustomCode`, `quantity`, `price`, `janCode`
- 회원: `memberGroupPoint`, `gmoPointMultiple`

**갱신(5단계 보류용)** — `updateOrderAttribute`(송장번호·고객정보·주소), `updateOrderDeliveryStatus`(未配送→出荷指示→配送完了→返品)

**엔드포인트 URL은 앱 개발·공개 승인 완료 시 발급.**

---

## 2. 매칭 키 — 검증 결과

| 코드 | 주문(API)가 주는 값 | 카탈로그 저장값 | 일치 |
|---|---|---|---|
| 商品番号(12자리) | — | `productCode` = `000000000227` | 카탈로그는 이것만 보유 |
| 独自商品コード | `HOYTSPREST` | 없음 | ❌ |
| variationCustomCode | `2716000153001` | 없음 | ❌ |
| **상품명** | `HOYT スーパーレスト` | `HOYT スーパーレスト` | ✅ |

→ 카탈로그 `productCode`는 MakeShop **商品番号**라 주문의 `独自商品コード`/`variationCustomCode`와 안 맞는다.
→ **1차 매칭 키 = 상품명 정확일치.** 매칭되면 `AricoCatalog.supplierProductId` → `Product` → `calcCostJpy`로 원가·마진 자동.
→ (옵션) 최초 매칭 시 `独自商品コード`를 카탈로그에 캐시해두면 다음부터 코드로 O(1). — 1단계에서는 생략 가능.

---

## 3. 데이터 모델 변경 (Prisma) — 착수 시

**Order** (추가)
| 필드 | 용도 |
|---|---|
| `source String @default("manual")` | 'manual' \| 'makeshop' |
| `externalOrderNo String? @unique` | `systemOrderNumber` — 중복방지 idempotent 키 |
| `externalMemberId String?` | 会員ID |
| `orderDate DateTime?` | 注文日時 |
| `paymentMethod String?` | 'credit_card' \| 'invoice' … |
| `listAmountJpy / pointsUsedJpy / pointsEarnedJpy / actualPaidJpy Int` | 포인트 회계(1pt=1엔) |
| `couponCode String? / couponDiscountJpy Int` | 쿠폰 |
| `deliveryStatus String?` | 未配送/出荷指示/配送完了 |

> 포인트 회계 규칙(확정): 매출 = 실수령(정가−사용포인트), 마진 = 실수령−원가. 적립 포인트는 **사용 시점 반영(현금주의)**, 적립 시엔 참고표시만. 온라인(EC) 회원 주문만 적용.

**Customer** (온라인 B2C 구분)
| 필드 | 용도 |
|---|---|
| `customerType String @default("b2b")` | 'b2b' \| 'online' |
| `externalMemberId String? @unique` | 会員ID 기준 upsert |
| email/phone/address | 注文者 정보 |

**OrderItem**
- `externalProductCode`, `externalVariationCode` (매칭 키 보존)
- `optionMemo` ← `左右:RH / カラー:ブラック`
- `isBackorder Boolean` ← 名前 `【取寄せ商品】` 접두 또는 카탈로그 availability. 기존 `procureStatus`(needed/ordered/received)와 연동.

> ⚠️ `prisma db push`는 pg_trgm GIN 인덱스를 드롭하므로 이후 `node scripts/restore-trgm.mjs`(또는 `prisma/trgm-indexes.sql`) 재실행. dev 서버가 Prisma DLL 락 → push 전 `preview_stop`.

---

## 4. 구현 단위

**`src/lib/makeshop.ts`** — GraphQL 클라이언트
- env: `MAKESHOP_GQL_ENDPOINT` / `MAKESHOP_API_TOKEN` / `MAKESHOP_API_KEY`
- `buildHeaders()` (authorization + x-api-key + x-timestamp)
- `gql(query, variables)` (POST, 5MB·에러 가드)
- `searchOrders({ since, until, page, limit })` (페이지 루프)
- `updateTracking` / `updateDeliveryStatus` — **5단계용, 1단계 미사용**
- **Mock 모드**: env 없으면 §6 fixture 반환 → Key 전 전 기능 빌드·검증.

**`/api/makeshop/sync`** — 주문 취득
1. `Setting`에서 `makeshop.lastSyncAt` 커서 로드
2. `searchOrders({ since })` 페이지 루프
3. 각 주문:
   - `externalMemberId`로 Customer upsert (customerType='online')
   - `externalOrderNo`로 Order upsert (있으면 상태/배송만 갱신 → 중복 X)
   - 품목마다 **상품명 정확일치**로 AricoCatalog 매칭 → `supplierProductId` → `calcCostJpy` 원가·마진
   - `【取寄せ商品】` 품목 → `procureStatus='needed'`(backorder 유입)
4. `lastSyncAt` 갱신
5. **Vercel Cron 15분** + 주문관리 화면 **[지금 동기화]** 버튼

---

## 5. 단계 로드맵

| 단계 | 내용 | 비고 |
|---|---|---|
| **1 (토대)** | API 클라이언트(+Mock) · 모델 마이그레이션 · sync · 주문/카탈로그 매칭/마진 | **이번 범위** |
| 2 | 取寄せ → backorder/PO 자동 유입 | |
| 3 | 결제채널(카드 仮売上→入金 자동 / 청구서 수동) + 입금상태 매핑 | |
| 4 | 포인트 회계(사용/적립) | |
| 5 | 출하 시 송장·상태 **역방향 push** | **보류** |

---

## 6. 시뮬 결과 (Mock fixture) — 주문 P186897473805218880

`新井花凛`(회원 260514000001) · 2026-06-25 22:13 · 카드(仮売上) · 쿠폰 コーチング会員.
실제 카탈로그 DB + `calcCostJpy`(환율 USD=161.68) 통과 결과:

| 상품 | 구분 | 옵션 | 판매가 | 매칭 | 공급사 | 원가 | 마진 |
|---|---|---|---|---|---|---|---|
| HOYT スーパーレスト | 在庫 | RH | ¥308 | exact | JVD | ¥13,805 | **-4382%** ⚠ |
| Beiter クリッカー ノーマル 0.25 | 在庫 | 6/32 | ¥2,200 | exact | JVD | ¥1,627 | 26.0% |
| Beiter プランジャー | 在庫 | ブラック | ¥20,900 | exact | JVD | ¥15,740 | 24.7% |
| FIVICS HYPER バックパック | 取寄 | ブラック | ¥13,200 | exact | FIVICS | ¥5,335 | 59.6% |
| WNS S-ALボウスタンド | 取寄 | ブラック | ¥6,160 | exact | JVD | ¥3,804 | 38.2% |
| SHIBUYA ULTIMA RCIV 520 カーボンサイト | 取寄 | RH/ブラック | ¥45,760 | **none** ⚠ | — | — | — |

- 상품 소계 ¥88,528 (스크린샷 小計와 일치) · 포인트 −1,704pt · 쿠폰 −¥660 · **실수령 ¥86,164** · 적립 +2,039pt
- 매칭 5/6 · 매칭 원가합 ¥40,311 · 取寄 3건 → 발주 유입 대상

**확인 필요 2건 (데이터 이슈, 둘 다 보류):**
1. **HOYT スーパーレスト — 낱개 vs 묶음(pack) 단가 불일치.** ¥308 낱개 판매인데 JVD가 묶음/다스 단가($77.62≈¥13,805)라 원가 과대계상 → 마진 음수. 매칭은 맞음. 전 카탈로그 정리 과제.
2. **SHIBUYA ULTIMA — 이름 표기차.** 주문 ASCII `IV` vs 카탈로그 유니코드 `Ⅳ(U+2163)`. 실제론 카탈로그 #261 "SHIBUYA ULTIMA RC**Ⅳ** 520 カーボンサイト"에 이미 매칭돼 있음. 정규화/유사도 fallback은 보류.

---

## 7. 화면 설계 (미리보기 확정)

주문관리 안에 동기화 화면. 구성:
- **상단 바**: 제목 "MakeShop 주문 동기화" + "마지막 동기화 …·신규 N건" + **[지금 동기화]** 버튼
- **주문 카드**: 주문번호(mono)·일시·온라인 회원 / 배지(온라인 회원·카드 仮売上·取寄 N)
- **품목 표**: 상품(+옵션 서브라인, 在庫/取寄 칩) · 판매가 · 공급사 · 원가 · 마진(색상; 음수·미매칭은 검수/미매칭 플래그)
- **합계**: 상품 소계 → 포인트 사용 → 쿠폰 → **실수령 합계** → 적립 예정
- **요약 카드 4개**: 매칭 N/M · 매칭 원가합 · 取寄→발주 N건 · 확인 필요 N건
- **하단 주석**: 확인 필요 항목 사유를 그대로 노출(숨김 없음)

미정(착수 시 결정):
- 取寄 3건을 이 화면에서 바로 발주? vs 백오더 탭으로 유입만?
- 온라인 주문을 기존 주문목록에 **섞기** vs **전용 탭** 분리?

---

## 8. 착수 체크리스트 (API Key 도착 시)

1. `.env` + Vercel에 `MAKESHOP_GQL_ENDPOINT` / `MAKESHOP_API_TOKEN` / `MAKESHOP_API_KEY` 등록
2. `searchOrder` 실제 응답 1건으로 필드명·매칭(상품명) 1건 검증 (특히 응답에 상품명 필드 유무 — 없으면 `productCode` 브리지 필요)
3. §3 모델 마이그레이션 (db push → trgm 복구)
4. `src/lib/makeshop.ts` Mock→실호출 전환, `/api/makeshop/sync` + Cron
5. §7 화면 연결, Mock fixture로 회귀 확인
