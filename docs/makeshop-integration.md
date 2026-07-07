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

### 매칭 설계 — JAN(바코드) 정본 + 이름 fallback + self-heal (2026-06-26 확정)

**왜 JAN인가:** `searchOrder` 품목 응답 필드는 `productCode / variationCustomCode / quantity / price / **janCode**` — **상품명(name)이 목록에 없다.** 이름 정확일치를 1차로 두면 "API가 이름을 안 주면 매칭 붕괴" 리스크. 반면 `janCode`는 응답에 있고, **Smaregi=재고 SSOT, 연결키=JAN** 전략과도 일치 → JAN을 정본 키로.

**인프라 이미 있음:** `AricoCatalog.barcode`(233행)·`Product.barcode`(47행) 둘 다 JAN용 필드+인덱스 존재, 비어만 있음. **스키마 변경 불필요.**

**매칭 순서 (sync 품목마다):**
```
1) order.janCode → AricoCatalog.barcode 정확일치 (인덱스)  → supplierProductId → calcCostJpy
2) 실패 → 상품명 정확일치 (현행, 기존 수동매칭 유지)
3) 매칭 성공 & catalog.barcode 비어있고 order.janCode 있으면
       → catalog.barcode = janCode   (self-heal: JAN 지도 자동 축적)
4) 다 실패 → 미매칭 큐(수동 연결 UI로)
```

**JAN 수급(채우기):**
- ❌ 자사몰 크롤 — **상품페이지에 JAN 미노출 확인(2026-06-26 probe: jan키워드·EAN-13·13자리 0건).** 크롤 backfill 불가.
- ✅ **MakeShop 商品 데이터 CSV/API** (商品番号·独自코드 ↔ JAN). 카탈로그 productCode=商品番号(12자리)와 키 매칭 → 일괄 backfill. **본진.**
- ✅ self-heal (위 3) — 주문된 상품만 점진 커버, 보조.
- (향후) Smaregi API.

**⚠️ 단위(granularity) 절충:** `AricoCatalog.barcode`는 상품 1행=1필드인데 JAN은 옵션별 SKU 단위라 옵션多 상품은 JAN이 여러 개 → 한 필드에 다 못 담음. **1단계는 옵션없는 단품=대표 JAN 1개로 완벽 매칭, 옵션 상품은 대표 JAN + 옵션은 주문 메모로 운용. 옵션별 정밀(per-SKU) 매칭은 Smaregi/OnlineSku 재논의 때 승급**(per-SKU 작업 보류 결정과 일관).

### 변형(옵션) 자동 resolve — `src/lib/optionDict.ts` (2026-06-26 PoC 완료)

카탈로그→공급사 변형그룹을 확정한 뒤, **주문에 들어온 옵션(일본어, 예 `RH / グラファイトブラック`)을 공급사 변형 축값(영어, `Graphite Black`)으로 정규화해 정확한 SKU를 결정론적으로 찾는다.**
- `optionDict.ts`: ja↔en 색상 사전(WIAWIS 팔레트) + 방향 정규화(右/左→RH/LH) + `matchAxisValue`(정규화일치→사전→방향정규화 순) + `mapIncomingToAxisSel`.
- `variants.ts resolveVariant(group.variants, sel)`로 SKU 확정.
- **PoC 검증(실 lib+DB)**: ATF-DX `RH/グラファイトブラック`→`119667-1060`, `右/サンオレンジ`→`119667-1130`, `LH/ホワイト`→`119667-1288`. 사전에 없는 색은 **"미해결" 플래그**(조용히 오매칭 안 함 → 사람 확인).
- 사용처: MakeShop sync에서 주문 품목 매칭 직후 이 단계로 변형 SKU 확정 → backorder/PO가 정확한 SKU로 감.
- 확장: 새 색상은 `COLOR_JA_EN`에 한 줄 추가. (관련: 주문 화면 orders/new도 신규 추가 시 색을 미리선택하지 않고 미선택 제출을 막도록 수정함 v1.18.3)
- **커버 범위(v1.18.4)**: 색상 사전 확장(표준색+WIAWIS+Mathews 추정) / 파운드 `ポンド↔#`·선두 `/` / 길이 숫자관용(32==32.0==32") / 방향 右左↔RH/LH / 사이즈 S·M·L. 단위 정규화는 `optionDict.matchAxisValue`. PoC 15케이스 전부 통과. **사전이 틀려도 안전**(영어 변환이 실제 축값과 정확일치할 때만 채택, 아니면 미해결).
- ⚠️ **알려진 한계(별도 과제)**: `variants.ts parseOption`이 컴파운드보우의 괄호 길이범위 `(15.0''-30.0'')`를 못 떼어 **색상 축에 새어듦**(예 `(15.0''-30.0'') Black/Red`) → 이런 변형은 자동 resolve가 미해결로 떨어진다(오매칭 아님). 코어 파서 개선은 UI 검증 가능할 때 별도로.

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
   - 품목마다 **§2 매칭 순서(JAN→이름→self-heal→미매칭큐)**로 AricoCatalog 매칭 → `supplierProductId` → `calcCostJpy` 원가·마진
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
2. `searchOrder` 실제 응답 1건으로 필드 검증 — **`janCode` 채워져 오는지**, 상품명 필드 유무 확인
3. **MakeShop 商品 CSV/API에 JAN 컬럼 확인 → `AricoCatalog.barcode` 일괄 backfill**(§2 본진)
4. §3 모델 마이그레이션 (db push → trgm 복구)
5. `src/lib/makeshop.ts` Mock→실호출 전환, `/api/makeshop/sync`(JAN 우선 매칭+self-heal) + Cron
6. §7 화면 연결, Mock fixture로 회귀 확인

---

## 9. 카탈로그 소스: 크롤 → API 대체 (2026-07-01 확정 방향)

연동하면 **자사몰 크롤(`aricoShop.ts`)은 더 필요 없다.** MakeShop 商品 API/CSV로 직접 가져온다.

| 항목 | 지금(크롤·스토어프론트 HTML) | MakeShop API/CSV |
|---|---|---|
| 데이터 | HTML 파싱(깨지기 쉬움) | **구조화 정식 데이터** |
| 이름·가격·포인트·이미지 | ✅ 파싱 | ✅ 필드 |
| 옵션(색/사이즈) | 부분·불안정 | ✅ 옵션 마스터 |
| **JAN(바코드)** | ❌ **스토어프론트 미노출(확인함)** | ✅ **상품 마스터에 있음** |
| 재고 연결 | ❌ | ✅ JAN으로 Smaregi 연결 |

- **핵심 이점: JAN을 API로 확보** → §2 "이름 매칭 → JAN 정본" 과제 해결(정확 SKU + Smaregi 재고 연결).
- **카탈로그 구조 자체는 유지**(자사몰↔공급사 매칭 다리). 채우는 소스만 크롤→API로 교체.
- 착수 시 확인: 상품 API가 이름·가격·**포인트**·이미지·옵션·**JAN**을 다 주는지 1건 검증(포인트는 상품별 설정/계산방식 확인).
- 기존 `aricoShop.ts` 크롤러는 fallback/폐기 예정으로 잔존.

---

## 10. 3-시스템 양방향 아키텍처 (MakeShop ↔ arico-hub ↔ Smaregi) — 2026-07-01 정리

**구도**: MakeShop=온라인 주문·결제·회원(SSOT) / Smaregi=**재고 SSOT**·오프라인 POS / arico-hub=오케스트레이터(주문수렴·매칭·발주·입고·배송·정산). 기존 재고 피드 Smaregi→MakeShop 단방향.

### 가능성 (API로 됨)
| 흐름 | 방향 | API |
|---|---|---|
| 주문 유입 | MakeShop→hub | searchOrder(GraphQL) |
| 재고 조회 | Smaregi→hub | 재고 API |
| 발송·송장·상태 | hub→MakeShop | updateOrderAttribute·updateOrderDeliveryStatus |
| 재고 변동(입고/출고) | hub→Smaregi | 재고조정 API (주의 최대) |
| 상품/JAN 등록 | hub→Smaregi | 상품 API |

→ "hub가 처리 → MakeShop(상태·송장)·Smaregi(재고) 되쓰기"는 **양쪽 API 모두 지원, 실현 가능.**

### 주의점 (여기서 깨짐)
1. **재고 SSOT=Smaregi.** hub가 자체 재고를 진실로 들면 어긋남 → **Smaregi에 쓰고 Smaregi에서 읽기만.**
2. **재고 이중반영/루프** — 온라인판매(기존 피드로 Smaregi 감소)+hub 발송감소+POS 판매가 같은 재고를 각자 깎으면 오버셀. **누가·언제 깎는지 규칙 확정 필수.**
3. **MakeShop 재고에 직접 쓰지 말 것** — Smaregi→MakeShop 피드가 이미 돌므로 hub는 Smaregi에만 쓴다(충돌 회피).
4. **동기화 지연→오버셀** — 폴링 간격 사이 판매. **예약(reserve)+재고확인 게이트** 필요.
5. **멱등성·부분실패** — 재시도/웹훅 중복이 재고 2번 깎거나 상태 2번 변경 금지 → idempotency 키. MakeShop 성공·Smaregi 실패 반쪽상태 → 재시도 큐+대사(fire-and-forget 금지).
6. **옵션/변형=JAN(SKU) 단위 정합** — 재고는 JAN별. hub 매칭이 상품(그룹)단위면 재고동기화 틀림 → barcode(JAN) SKU 정체성 전제.
7. **API 제약/인프라** — MakeShop 5MB·토큰1h, Smaregi 레이트리밋 → 배치+백오프. Vercel 타임아웃 → 백그라운드 잡/큐.
8. **라이브 직접쓰기=사고** — dry-run/샌드박스 없이 쓰기 금지.

### 안전한 단계 (읽기 먼저, 쓰기는 한 방향씩)
- **P1 읽기전용**: MakeShop 주문유입 + Smaregi 재고조회. 위험 0.
- **P2 MakeShop 되쓰기만**: 발송/송장/상태. 저위험.
- **P3 Smaregi 재고쓰기**: "누가 언제 깎나"+예약모델 확정 후. 진짜 난관.

### 지금 정할 3가지
- 재고 깎는 주체·시점(온라인=피드 / 발송=hub / POS=Smaregi) 겹치지 않게.
- 동기화 방식: 폴링(간단·지연) vs 웹훅(실시간·복잡).
- JAN(SKU) 정합: 카탈로그/상품에 JAN 언제 채우나(§9 API/CSV).

---

## 11. 주문서 파일 임포트 → 신규주문 생성 (2026-07-07 기획, 미착수)

**목적:** API 연동 전, **주문서 파일을 읽어 신규주문을 생성**하는 실용적 다리. MakeShop API가 오면 이 임포트·검수 화면을 **API 주문 수신의 검수 화면으로 그대로 재사용**(파일 대신 API가 같은 자리로 흘려보냄) → 이게 §1 수신의 P1.

### 흐름 (① 업로드 → ② 파싱·매핑 → ③ 자동매칭 → ④ 검수 → ⑤ 생성)
1. **업로드** — 신규주문 화면(`/orders/new`)에 `주문서 임포트` 버튼. CSV/Excel 업로드(+붙여넣기). 기존 xlsx 파서(`/api/import`, `/api/customers/import`) 재사용.
2. **파싱·컬럼 매핑** — 헤더 자동감지 → `거래처 / 상품명·코드·JAN / 수량 / 옵션 / 단가`로 매핑. 안 맞으면 드롭다운 수동 지정. **프리셋 기억**(MakeShop 내장 / 거래처별 저장).
3. **자동 매칭** (기존 로직 재사용, 새 매칭 로직 X)
   - 거래처: 이름·회사명으로 기존 거래처 매칭 → 없으면 "신규 생성" 제안(거래처 할인 자동 적용).
   - 품목: **JAN(바코드) 우선** → 상품코드 → 이름 유사도(`/api/auto-match` 로직) → **optionDict로 옵션(색상·방향) 해결**. 라인별 매칭 신뢰도 표시.
4. **검수 (사람 확인) — 가장 중요.** 신규주문 폼에 매칭 결과를 채워 표시. **미매칭 라인 빨강 플래그 + 수동 연결**(기존 pendingCatalog "카탈로그↔공급사 연결" 흐름 재사용). 수량·단가·옵션 수정 가능, 원가는 매칭 상품 `calcCostJpy` 자동. **검수 전 자동 저장 절대 안 함**(매칭 fuzzy).
5. **생성** — 확인 시 기존 `POST /api/orders`(할인·역반영 그대로).

### 입력 형태 (사용자 확정: 둘 다)
- **MakeShop 주문 내역 CSV** — `janCode` 있어 **JAN 정본 매칭**으로 대부분 자동, 검수 최소. 컬럼 고정 → 프리셋 내장.
- **거래처 발주서 Excel** — 보통 상품명·수량만(코드/JAN 없음) → **이름 유사도 매칭** 비중↑, 검수에서 손볼 게 많음. 양식 제각각 → 컬럼 매핑 유연성 + 거래처별 프리셋 저장 필수.
- (옵션) 표 붙여넣기 — 파일 없이 가볍게.

### 주의점
- 매칭 실패해도 막지 않고 검수에서 처리.
- **중복 방지**: 같은 주문번호/외부ID 재임포트 시 경고(스킵/덮어쓰기 선택).
- 임포트 단가 = 판매가, 원가는 매칭 상품에서 자동.
- 여러 주문이 한 파일이면 **v1은 1주문씩**, 주문번호별 그룹핑은 v2.
- JAN 채우기는 §2/§9와 연동(카탈로그·상품 barcode 필드는 이미 있음, 비어 있음).

### 범위
- **P1**: 파일 업로드 → 컬럼 매핑(프리셋) → 자동매칭 → 검수 → 생성. (샘플 CSV/Excel 있으면 컬럼 프리셋 정밀화; 없어도 자동감지+수동매핑으로 동작)
- **P2**: 주문번호별 다중 주문, 매핑 프리셋 관리 UI 고도화.
- **P3**: MakeShop API 자동 수신이 ③~⑤ 재사용(§1).
