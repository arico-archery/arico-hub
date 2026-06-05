@AGENTS.md

# ARICO Distribution Hub — 작업 현황 (2026-06-02)

## 프로젝트 개요
양궁 장비 유통 통합 관리 플랫폼. 7개 공급처의 원가·주문·입금·발주를 단일 웹앱으로 관리.
- 기획서: `../아리코_유통통합플랫폼_기획서.md`

---

## 기술 스택 (확정)

| 구분 | 기술 |
|------|------|
| 프론트엔드 | Next.js (App Router) + TailwindCSS |
| DB | SQLite (Prisma ORM) — `prisma/schema.prisma` |
| 기준 통화 | **JPY** (KRW 아님 — 일본 고객 대상) |
| UI 언어 | 한국어/일본어 토글 (`src/lib/i18n.tsx`, `translations.ts`) |
| 크롤러 | Python Playwright (JVD, SIBUYA) |

---

## 공급처 목록 (7개, 원래 기획 6개에서 WJ 추가)

| 코드 | 공급처 | 통화 | 원가 취득 | 세금 | 할인 |
|------|--------|------|----------|------|------|
| JVD | JVD Archery | USD | Excel 가격표 (parse_jvd_excel.py) | - | 등급가 자동 |
| MK | MK Archery | USD | 수동 업로드 (PDF) | - | $20K→3%, $40K→5% |
| FIVICS | FIVICS | USD | 수동 업로드 (Excel) | - | PREMIUM 고정단가 |
| SIBUYA | Shibuya | JPY | 자동 크롤링 | 税込 | 브랜드별 掛率 |
| KOREA | Korea Archery | JPY | 수동 업로드 (PDF) | 税込 | 수량할인 |
| ANGEL | Angel Archery | JPY | 수동 업로드 (PDF) | 税抜 | 掛率 60%/70% |
| WJ | WJ Sports | (미정) | 미정 | - | - |

---

## 원가 계산 규칙 (`src/lib/utils.ts` — `calcCostJpy()`)

```
SIBUYA SHIBUYA자체브랜드 → 希望小売価格(税込) × 0.62   (costPrice=希望小売価格 그대로 저장)
SIBUYA 기타브랜드(HOYT/EASTON/WIAWIS 등) → 希望小売価格(税込) × 0.65
외화 공급처(JVD=USD, MK=USD, FIVICS=USD) → 원가 × 환율(JPY환산) × 1.1(운송+관세)
ANGEL → 税抜가격 × 0.70(クィーバー/ベルトネーム加工/トリートメント/ダビン) / × 0.60(그외)
KOREA → 세금 제거 → 掛率 적용
```

> **SIBUYA 데이터 주의**: 웹크롤(`crawl_sibuya.py`, productCode `0000…`) 1,346개는 希望小売価格 기준.
> 옛 상품데이터 파일 임포트분(productCode `SBY-…`) 14,313개는 판매가(商品単価) 기준으로 남아있음(주문 미사용, 보류 결정 2026-06-02).

---

## 2026-06-02 작업 완료 내역 (세션 1)

### XLSX (Excel) 임포트 지원
- `npm install xlsx` (SheetJS)
- `/api/import/route.ts` — `.csv` / `.xlsx` / `.xls` 자동 판별 파싱
- FIVICS 전용 컬럼 매핑: `PREMIUM` → costPrice, `MSRP` → msrp, 대소문자·공백 무관 매칭
- `skipped` 카운트 반환 (productCode/name 없는 행 자동 스킵)

### MK 볼륨 할인 계산 수정
- `src/lib/utils.ts` — `calcCostJpy()`: USD 공급처에도 `supplier.discount` 적용
- 설정 페이지에서 MK 할인율(0.03=3%, 0.05=5%) 세팅 시 원가 자동 반영

### 설정 페이지 개선
- XLSX 파일 허용: `accept=".csv,.xlsx,.xls"`
- 공급사 선택 시 설명 + 허용 파일 형식 표시
- **CSV 템플릿 다운로드** 버튼: 공급사별 기대 컬럼명 포함 템플릿 CSV 즉시 생성
- MK 볼륨 할인 안내 박스 추가 (0/0.03/0.05 값 설명)
- 임포트 결과에 `skipped` 카운트 표시

### 자동 매칭 API + UI
- `/api/auto-match/route.ts` — `match_catalog.js` 로직을 TypeScript로 포팅
  - 브랜드→공급사 매핑, 이름 정규화, 유사도 계산(포함/키워드/LCS), 코드 직접 매칭
  - `dryRun`, `threshold`, `supplier` 파라미터 지원
- `/catalog` 페이지: **미리보기** (dryRun) + **자동 매칭** (저장) 버튼 추가
  - 결과 배너: 매칭/스킵/저장 수, 공급사별 분포 표시

### Analytics 페이지 전환
- Server Component → **Client Component**로 전환
- `/api/analytics` 엔드포인트 신규 생성 (기간 파라미터: `6m`/`12m`/`ytd`/`all`)
- **기간 필터** UI 추가 (최근 6개월 / 12개월 / 올해 / 전체)
- `useT()` i18n 적용, 로딩 스피너 추가

### 번역 수정 (1차)
- `translations.ts` — ja common에 `deleting: '削除中...'` 누락 추가

---

## 2026-06-04 작업 완료 내역 (세션 3) 🆕

### 원가 계산 규칙 확정
- 외화(JVD=USD/MK=USD/FIVICS=USD): `costPrice × 환율(JPY) × 1.1` (엔화 환산 후 운송+관세 10%)
- SIBUYA: `희망소매가(税込) × 0.62`(SHIBUYA 자체브랜드) / `× 0.65`(HOYT/EASTON/WIAWIS 등 기타)
  - costPrice에 希望小売価格 그대로 저장 (`/1.1` 안 함)
- ANGEL: `税抜가격 × 0.70`(クィーバー/ベルトネーム加工/トリートメント/ダビン) / `× 0.60`(그외)
  - `src/lib/utils.ts` `ANGEL_70_PATTERN` 정규식으로 품목 판별

### JVD 재임포트
- `parse_jvd_excel.py` 신규 — `JVD price.xlsx`(PRICELIST 시트) → DB 직접 임포트
- 53,519개 (closeout·가격0 제외). 통화 USD (가격표 쉼표를 소수점으로, 달러 취급)

### SIBUYA 재크롤링
- `crawl_sibuya.py` 수정 — 페이지수 자동감지 + 상세페이지 `.fixed-price`에서 希望小売価格 추출
- `import_supplier_csv.py` — SIBUYA는 `costPrice = 希望小売価格` 원본 저장
- 웹크롤 1,346개(productCode `0000…`, 희망소매가) / 옛 파일 14,313개(`SBY-…`, 판매가, 보류)

### 카탈로그 자동매칭 고도화 (`/api/auto-match`)
- **공급처 우선순위 + SIBUYA fallback**: `detectSuppliers()` — 주공급사(JVD 등) 먼저,
  threshold 미달 시 SIBUYA(일본어) 후보 재시도. 카탈로그=일본어, JVD=영어라 SIBUYA 매칭률↑
- **중복 제품 원가 비교**: JVD∩SIBUYA 양쪽 매칭 시 `calcCostJpy`로 원가 비교 → **더 싼 곳 채택**
  (원가 동점/한쪽만 매칭 시 JVD 우선). Product select에 costPrice 추가, Supplier·ExchangeRate 로드
- **수작업 매칭 보호**: 저장을 `updateMany({where:{id, supplierProductId:null}})`로 변경
  → 이미 매칭된(수작업 포함) 카탈로그는 절대 덮어쓰지 않음
- threshold 0.65로 저장 (0.45는 오매칭 다수 — FIVICS→JVD인도어 등 저품질 제외)
- catalog 페이지 i18n: 환율표시/미리보기/자동매칭 버튼·결과 메시지 전부 번역키화 (`t.catalog.*`)

### 카탈로그 dangling 참조 버그 수정
- 증상: JVD 재임포트로 삭제된 상품을 카탈로그가 계속 가리켜(dangling 256개) "매칭됨" 필터엔 잡히나 화면엔 "공급사 상품 매칭"(미매칭)으로 표시
- 정리: dangling 256개 `supplier_product_id=NULL` → 재매칭 → 최종 매칭 649개(SIBUYA 448·JVD 51), dangling 0
- 방지: `parse_jvd_excel.py` 임포트 후 dangling 자동 정리. (schema relation+onDelete:SetNull은 차후)
- 성능: simPP에서 키워드 양쪽 존재+공통0이면 lcs 생략(타임아웃 완화)
- 필터 라벨 `✅ 매칭됨/⬜ 미매칭` → `매칭됨/미매칭` (이모지 제거, 선택은 배경 강조)

### 주문→카탈로그 매칭 학습 (사람 검증 매칭 누적)
- ARICO 카탈로그에서 선택해 주문하면 그 매칭(catalogId↔공급사 productId)을 카탈로그에 반영
  → 사람이 실제 주문에서 확정한 매칭이라 자동매칭보다 신뢰도 높음, 주문 쌓일수록 정확해짐
- `orders/new`: OrderLine에 `catalogId` 추가 → addCatalogItem에서 `item.id` 캡처 → handleSubmit items에 포함
- `/api/orders` POST: `catalogId` 있는 항목 → `aricoCatalog.supplierProductId = productId` 갱신
- **주문화면 미매칭 카탈로그 연결 UI**: 미매칭 카탈로그 클릭 → `pendingCatalog` 설정 + 공급사 검색 모드 전환
  + amber 배너("「상품명」에 연결할 공급사 상품을 선택하세요") → 공급사 상품 선택 시 그 카탈로그와 묶어 주문라인 추가(catalogId 포함)
  → 주문 시 카탈로그 매칭에 반영. addProduct가 pendingCatalog 있으면 catalogId/카탈로그가격 연결
- **이미 매칭된 카탈로그도 공급사 변경**: 카탈로그 검색결과 항목에 "변경"(RefreshCw) 버튼 → startLinkSupplier(공용)로 공급사 재선택
- **주문 정보 역반영** (`/api/orders` POST): 주문의 판매가/매칭을 공급사상품·카탈로그에 반영
  - 공급사상품 salePriceJpy가 0이면 → 주문 판매가로 채움
  - catalogId 있으면 → supplierProductId 갱신(공급사 변경 포함) + 카탈로그 priceJpy 0이면 주문가로 채움
- 검증: e2e PASS — 주문→매칭변경(6888→1)·카탈로그가격(0→5000)·상품판매가(0→5000) 모두 반영 확인

### 주문 시 옵션 선택 (색상/사이즈/방향)
- 결정: 옵션=개별상품 현행 유지 (정규화 대공사 X). 옵션별 가격 다를 수 있어 개별상품·가격 유지가 안전
- 양궁 옵션 데이터 특성:
  - SIBUYA: optionSize/optionColor **필드** 있음 → name에서 옵션값 빼면 베이스 묶임 (변형 그룹핑 가능)
  - JVD: 옵션이 이름에만 + 색상×강도×길이로 폭발(prefix당 1872개) → 그룹핑 부적합, 자유입력
- `/api/products/variants?productId=X`: baseName(name−optionSize−optionColor)으로 같은 공급사 변형 조회
  - 첫단어(브랜드) prefix로 후보 좁힘(공백표기 불일치 회피) + baseName 정밀비교. 2~60개만 반환(폭발 그룹 제외). ~0.16초
- orders/new: 상품 추가 시 loadVariantsFor → 변형 ≥2면 주문라인 비고칸이 **옵션 드롭다운**(LH/オレンジ 등)
  - changeVariant: 옵션 선택 시 productId·원가(calcCostJpy)·optionMemo 교체. 변형 없으면(JVD 등) 기존 자유입력
- 검증: SIBUYA ARGON X 18변형(LH9/RH9) 드롭다운 표시·선택 OK, JVD 0개(자유입력) OK

### 반응형 + 다크모드 가독성 (2026-06-04)
- viewport: `layout.tsx`에 `export const viewport`(width=device-width, initialScale=1) 추가
- globals.css 색상 토큰: `--bg/--surface/--text/--muted/--border/--link` + prefers-color-scheme 라이트/다크
  - 순수흰 #ffffff→#fafafa, 다크는 slate 톤(#0f172a/#1e293b). 다크 muted는 slate-300(밝게)로 묻힘 방지
  - 대비 검증: 라이트 본문17:1·보조7.2:1 / 다크 본문16:1·보조12:1 (모두 WCAG AA 4.5:1 초과)
  - html,body overflow-x:hidden + img/table/pre max-width:100%
- Sidebar: `w-16 md:w-60` — 모바일 아이콘만(라벨 hidden md:inline), 데스크톱 전체
- 고정 grid-cols 12곳 → 반응형(grid-cols-1/2 sm/lg:grid-cols-N). 레이아웃 분할은 lg:로 데스크톱 유지
- 테이블 래퍼 6곳: overflow-hidden→overflow-x-auto + table min-w-[640~760px] (좁은 화면 가로스크롤)
- 검증: 모바일(375px) 가로스크롤 0px, 사이드바 64px, 라벨 숨김 OK

### 매칭/옵션/데이터 개선 (2026-06-04 — 회고 기반)
1. **방향(LH/RH) 정합성 가드** (auto-match): `direction()` — 이름의 LH/RH/左右 추출, PP에 캐싱.
   simBest에서 `catPP.dir && prodPP.dir && 다르면 return 0` → 좌/우 오매칭 차단.
   기존 오매칭 1건(catId 203) 해제·재매칭 → RH 상품에 올바로 재매칭. 전체 649건 방향불일치 0건
2. **FIVICS/MK 옵션 빠른선택 칩** (orders/new): SIBUYA와 달리 "한 행에 옵션 다발"(`LH ONLY / L,M,S (BK,BL,RD)`)
   → `parseOptionChips()`로 괄호색상+색상풀네임+사이즈+방향 추출, 라인에 클릭 칩(optionMemo 토글).
   검증: FIVICS A2 CHEST GUARD → [BK,BL,RD,MT,PK,L,M,S,XS,LH] 칩 표시 OK
3. **schema FK onDelete:SetNull**: `AricoCatalog.supplierProduct → Product` relation 추가, db push.
   상품 삭제 시 카탈로그 매칭 자동 NULL → dangling 근본 차단. 데이터 보존 확인, FK 동작 PASS
   ※ prisma generate가 dev서버 DLL 락으로 EPERM — 코드가 relation 미사용이라 무영향, 서버 재시작 시 정리
- 백업: prisma/dev.db.backup_20260604_125157

### ARICO 자사몰 옵션/가격 → 카탈로그 반영 (2026-06-04)
- ARICO 자사몰(arico-archery.com)은 MakeShop. 상품 페이지 `select.makeshop-option-select`에 옵션(`サイズｰポンド/カラー` 등), 라벨은 `.makeshop-option-label`
- schema: `arico_catalog.options` String 추가(JSON `[{label,values}]`). db push (※generate는 dev서버가 DLL락 → preview_stop 후 포트3000 프로세스 kill하고 generate해야 함)
- `collect_arico_options.py`: 카탈로그 url 순회(requests, SSR), 옵션+가격(price_jpy/msrp_jpy) 갱신. 792개 중 **옵션보유 579개(73%)**, 매칭+옵션 488개
- `arico_crawler.py` 보강: extract_product에 옵션 추출 + options 필드/CSV컬럼 (향후 전체 재크롤용)
- 주문 UI(orders/new): CatalogItem.options 파싱 → 라인에 **축별 옵션 드롭다운**(catalogOptions). 선택 시 selectCatalogOption이 optionMemo를 `라벨: 값 / 라벨2: 값2`로 갱신. 우선순위: 카탈로그옵션 > SIBUYA변형 > FIVICS칩 > 자유입력
- 검증: ZEILO シャフト 주문 → 옵션 `スパイン: 1500/1400…` 드롭다운 표시·선택 OK
- 향후(B): MakeShop 商品データ CSV 받으면 가격+옵션+원가 일괄(import_sibuya_shop.py 방식)

### 주문관리 개선 — 삭제 가시성·견적서 분리·편집 (2026-06-04)
1. **행 액션 버튼**: 주문 테이블 마진 옆에 편집(Pencil)·삭제(Trash2) 버튼 w-4(16px)로 추가 → 확장 안 해도 보임. 삭제는 stopPropagation+확장+삭제확인
2. **견적서 열기 분리**: orders/new 등록 버튼이 원래 '주문 등록 + 견적서 열기' 단일 → **[주문 등록] + [주문 등록 + 견적서]** 2버튼으로 분리. handleSubmit(openInvoice) 파라미터로 invoice 새탭 여부 제어
3. **주문 편집**: `/api/orders/[id]` PATCH에 items 배열 오면 트랜잭션으로 품목 전체 교체+합계 재계산, customerId 변경 지원. orders/new가 `?edit=<id>`면 GET 로드→폼 채움→PATCH(품목 추가/삭제/수정). 헤더 '주문 편집', 버튼 '변경 저장'/'저장+견적서'
- 검증: 편집 e2e PASS(품목1→2, 합계 4000·원가1800 재계산), 행버튼 w-4, 편집모드 로드(고객·품목·버튼2개) OK
- 신규 번역키: orders.newSubmitAndInvoice/newSaveEdit/newSaveAndInvoice/editTitle/editSubtitle

---

## 2026-06-02 작업 완료 내역 (세션 2)

### i18n 전면 점검 — 한국어 잔존 문자열 전부 일본어 변환

#### Analytics 탭 — 월 레이블
- `/api/analytics/route.ts`: `shortLabel: '6월'` 제거 → `month: number`, `year: number` 숫자만 반환
- `analytics/page.tsx`: `${m.month}${t.analytics.monthUnit}` 로 클라이언트에서 생성
  - 한국어: `6월 (3건)` / 일본어: `6月 (3件)`
- 신규 번역키 추가: `analytics.monthUnit` (월/月), `analytics.range6m/12m/ytd/all`,
  `analytics.cumulativeSales/cumulativeProfit/thisMonth/momChange/monthlyTrend/bySupplier`,
  `analytics.topCustomers/topProducts/unpaid/totalOrders`

#### 설정 탭 — 임포트 섹션
- `SUPPLIERS` 배열의 `desc: string` → `descKey: 'descJvd'|'descMk'|...` 타입 필드로 변경
- 섹션 제목 `공급사 상품 가격표 임포트` → `t.settings.importTitle`
  - 일본어: `仕入先商品CSVインポート`
- 6개 공급사 설명 번역키: `settings.descJvd/Mk/Fivics/Sibuya/Korea/Angel`
- `허용 형식:` → `t.settings.allowedFormat` (対応形式:)
- 파일 선택 UI: 네이티브 `<input type="file">` 브라우저 로케일 한국어 방지
  → 커스텀 버튼+숨긴 input + drag-drop 구현 (`fileInputRef`)
- 신규 번역키: `settings.fileNotSelected`, `settings.clickToSelect`, `settings.dropHere`,
  `settings.allowedFormat`, `settings.descJvd/Mk/Fivics/Sibuya/Korea/Angel`

#### 백오더 탭
- `N건` → `N${t.common.cases}` (N件)
- `미발주 N건` → `${t.backorders.unordered} N${t.common.cases}` (未発注 N件)
- `예정:` → `${t.backorders.expectedLabel}:` (予定:)
- `N개 품목` → `N${t.common.items}` (N点)
- `N건 → PO 1건` → `N件 → PO 1件`
- 신규 번역키: `backorders.unordered`, `backorders.expectedLabel`, `backorders.groupSuffix`

#### 주문 탭 — 삭제 다이얼로그
- 삭제 확인 텍스트 전부 번역키로 교체
- 신규 번역키: `orders.deleteConfirmText`, `orders.deleteConfirmSub`, `orders.deleteBtn`
- 모듈 레벨의 미사용 `STATUS_LABELS`, `PAY_LABELS` 상수 제거 (한국어 하드코딩)

#### 제품 탭
- `전체`, `더 보기...` → `t.common.all`, `t.products.showMore`
- `저장됨`, `로딩 중...`, `품절`, `한정`, `상품이 없습니다` → 번역키
- 신규 번역키: `products.showMore`

#### 거래처 탭
- `총 N개 거래처` → `${t.common.total} ${N}${t.customers.subtitleCount}`
- `N건` → `N${t.common.cases}`
- 신규 번역키: `customers.subtitleCount`, `customers.labelMemo`

#### 환율 탭
- 4개 설명 행 → `t.exchangeRates.applyDescJvdMkFivics/Sibuya/Korea/Angel`

### 빌드 검증
- `✓ Compiled successfully in 14.5s`
- `✓ Generating static pages (35/35)`
- TypeScript 오류 없음

---

## 완료된 것 ✅

### DB 스키마 (Prisma + SQLite)
- `Supplier` — 7개 공급처 (code, currency, taxRate, discount, priceType)
- `Product` — 상품 (costPrice 외화, salePriceJpy JPY 판매가, optionSize/Color, imageUrl×3)
- `ExchangeRate` — 환율 (currency, rateToJpy)
- `Customer` — 거래처 (code, name, company, grade)
- `Order` — 주문 (orderNo, paymentStatus, totalAmountJpy, totalCostJpy)
- `OrderItem` — 주문상세 (procureStatus: needed/ordered/received)
- `PurchaseOrder` — 발주서 (poNo, status: draft/ordered/partial/received/cancelled)
- `PurchaseOrderItem` — 발주 품목 (quantity, receivedQty, unitCostJpy)
- `StockLevel` — 재고 (quantity, reservedQty, reorderPoint)
- `AricoCatalog` — ARICO 자사몰 카탈로그 (productCode, priceJpy, supplierProductId 연결)
- `Setting` — 시스템 설정 (key/value)

### 페이지 (모두 구현 완료)
| 경로 | 기능 |
|------|------|
| `/` | 대시보드 — 월매출/이익, 미입금 알림, 공급사별 상품 현황, 최근주문 |
| `/products` | 공급사 상품 목록 (원가·판매가·마진율, 공급사 필터, 가격 미설정 알림) |
| `/catalog` | ARICO 카탈로그 — 자사몰 상품과 공급사 상품 매칭 (96개씩 페이지) |
| `/orders` | 주문 목록 (상태별 필터, 마진율 표시) |
| `/orders/new` | 신규 주문 등록 |
| `/backorders` | 백오더 리스트 (procureStatus별 — 미발주/발주완료/입고완료) |
| `/purchase-orders` | 발주서 목록 |
| `/purchase-orders/new` | 신규 발주서 작성 |
| `/purchase-orders/[id]` | 발주서 상세 + 입고 처리 |
| `/payments` | 입금 관리 (미입금/부분입금/완료) |
| `/customers` | 거래처 관리 |
| `/analytics` | 수익 분석 (공급사별/품목별) |
| `/exchange-rates` | 환율 설정 (수동 + Naver API 자동 조회) |
| `/settings` | 시스템 설정 |
| `/invoice/[id]` | 인보이스 — 브라우저 인쇄 (`PrintButton.tsx`) |
| `/translate` | 번역 도구 (ja/ko/en, 히스토리 20건 저장) |

### API 라우트
| 라우트 | 기능 |
|--------|------|
| `/api/dashboard` | 대시보드 집계 데이터 |
| `/api/products` | 상품 CRUD + bulk-price 일괄 가격 설정 |
| `/api/suppliers` | 공급사 목록 |
| `/api/customers`, `/api/customers/[id]` | 거래처 CRUD |
| `/api/orders`, `/api/orders/[id]` | 주문 CRUD |
| `/api/purchase-orders`, `/api/purchase-orders/[id]` | 발주서 CRUD |
| `/api/backorders` | 미발주 품목 조회 |
| `/api/backorders/create-po` | 백오더에서 발주서 자동 생성 |
| `/api/stock` | 재고 조회/수정 |
| `/api/exchange-rates` | 환율 조회/수정 |
| `/api/exchange-rates/naver` | Naver 금융 환율 크롤링 |
| `/api/settings` | 시스템 설정 CRUD |
| `/api/import` | 상품 데이터 일괄 임포트 |
| `/api/arico-catalog` | ARICO 카탈로그 조회/매칭 |
| `/api/translate` | Claude API 기반 번역 |

### 공통 컴포넌트
- `Sidebar.tsx` — 11개 메뉴 네비게이션, 한/일 토글
- `SupplierBadge.tsx` — 공급사별 컬러 뱃지
- `ProfitBar.tsx` — 마진율 시각화 바
- `src/lib/utils.ts` — `calcCostJpy()`, `formatJpy()`, `calcProfitRate()`, SUPPLIER_COLORS, SUPPLIER_LIST

### 크롤러 스크립트
- `jvd_prices_20260528_1007.csv` — JVD 크롤링 결과 (수집 완료)
- `jvd_errors_20260528_1007.csv` — JVD 크롤링 에러 로그
- `import_sibuya_shop.py` — SIBUYA 상품 임포트 스크립트
- `match_catalog.py` / `match_catalog.js` — 공급사 상품↔ARICO 카탈로그 자동 매칭

---

## 진행 중 / 미완성 🔄

### 1. 배송 관리 페이지
- DB 스키마에 `delivery` 모델이 없고 사이드바에도 없음
- 현재 `Order`에 `trackingNo`, `shippingDate`, `deliveryDate` 필드만 존재
- 주문 목록에서 인라인으로 발송 처리 가능 (운송장 번호 + 날짜 입력)
- → 별도 배송 전용 페이지는 필요 없을 수 있음. 요구사항 확인 필요

### 2. PDF 인보이스 출력
- `/invoice/[id]` 페이지는 있고 `PrintButton.tsx`로 브라우저 인쇄 가능
- React-PDF 기반 다운로드 기능은 미구현 (브라우저 인쇄만 가능)

### 3. WJ Sports 공급처
- 사이드바/대시보드/SUPPLIER_COLORS에는 추가되어 있음
- DB seed나 실제 데이터 취득 방식 미정

### 4. JVD 크롤링 자동 스케줄
- CSV 파일로 1회 수집한 결과 존재 (`jvd_prices_20260528_1007.csv`)
- 매일 자동 실행 스케줄(cron) 미설정

---

## 다음 할 일 📋

### 우선순위 높음
1. **실제 데이터 입력 및 검증**
   - JVD: `jvd_prices_20260528_1007.csv` → 설정 페이지에서 JVD 선택 후 업로드
   - FIVICS: Excel 가격표 → 설정 페이지 업로드 테스트 (`.xlsx` 지원 완료)
   - MK: CSV 업로드 후 할인율 설정 (0.03 or 0.05)
   - KOREA/ANGEL: CSV 업로드
   - 카탈로그 자동 매칭 실행 (`/catalog` → 미리보기 → 자동 매칭 버튼)

2. **ANGEL 掛率 70% 품목 처리**
   - 현재는 공급사 전체에 단일 discount 적용 (기본 0.60)
   - 퀴버·벨트 네임 가공, 트리트먼트·다빈 품목은 0.70 적용 필요
   - → 해결책 A: 해당 품목만 DB에서 costPrice 직접 수정
   - → 해결책 B: `Product` 모델에 `discountOverride Float?` 필드 추가

3. **i18n 실제 동작 검증**
   - 앱 실행 후 언어 토글 → 일본어 모드에서 전 탭 시각 확인
   - 특히 분석/설정/백오더/주문 탭

### 우선순위 중간
4. **배송 관리 필요 여부 결정** — 현재 주문 목록 인라인으로 충분한지 확인

5. **입금 알림** — 미입금 7일/14일 초과 시 알림 (대시보드에 이미 부분 구현됨)

6. **Analytics 월별 선택** — 현재 6m/12m/ytd/all, 특정 월 드릴다운 기능

### 우선순위 낮음
7. JVD 자동 크롤링 cron 스케줄 설정
8. PDF 청구서 다운로드 (React-PDF)
9. 환율 자동 업데이트 스케줄
10. 이메일 자동 발송 (청구서, 입금 요청)
11. WJ Sports 데이터 취득 방식 결정

---

## 중요한 결정사항 📌

| 항목 | 결정 | 근거 |
|------|------|------|
| 기준 통화 | **JPY** (KRW 아님) | 일본 고객 대상, 판매가도 JPY |
| DB | **SQLite** (Supabase 아님) | 로컬 단독 운용, 초기 기획에서 변경 |
| 공급처 수 | **7개** (기획서의 6개 + WJ Sports) | WJ Sports 추가됨 |
| SIBUYA 원가 | 희망소비자가 × 掛率 (SIBUYA브랜드 0.62, 기타 0.65) | 도매가 없음, 소비세 제거 후 적용 |
| ANGEL 원가 | 표시가격(税抜) × 掛率 (기본 0.60, 퀴버·벨트·트리트먼트 0.70) | 2026-04-21 출하분부터 |
| USD 원가 계산 | 달러원가 × 1.1(운송+관세) × 환율 | 통관 비용 10% 일괄 적용 |
| 인보이스 출력 | 브라우저 인쇄 (React-PDF 미사용) | 빠른 구현 우선 |
| 번역 기능 | Claude API (`/api/translate`) | 상품명 ja→ko 번역 실무 활용 |

---

## 파일 구조 요약

```
arico-hub/
├── prisma/schema.prisma          # DB 스키마 (SQLite)
├── src/
│   ├── app/
│   │   ├── (dashboard)/          # 모든 메인 페이지
│   │   │   ├── page.tsx          # 대시보드
│   │   │   ├── products/         # 공급사 상품
│   │   │   ├── catalog/          # ARICO 카탈로그 매칭
│   │   │   ├── orders/           # 주문 관리
│   │   │   ├── backorders/       # 백오더
│   │   │   ├── purchase-orders/  # 발주 관리
│   │   │   ├── payments/         # 입금 관리
│   │   │   ├── customers/        # 거래처
│   │   │   ├── analytics/        # 수익 분석
│   │   │   ├── exchange-rates/   # 환율 설정
│   │   │   ├── settings/         # 시스템 설정
│   │   │   └── translate/        # 번역 도구
│   │   ├── api/                  # API 라우트
│   │   └── invoice/[id]/         # 인보이스 인쇄
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── SupplierBadge.tsx
│   │   └── ProfitBar.tsx
│   └── lib/
│       ├── utils.ts              # calcCostJpy, SUPPLIER_COLORS 등
│       ├── i18n.tsx              # 한/일 언어 컨텍스트
│       ├── translations.ts       # ko/ja 번역 문자열
│       └── prisma.ts             # Prisma 클라이언트 싱글톤
├── import_sibuya_shop.py         # SIBUYA 임포트 스크립트
├── match_catalog.py/.js          # 카탈로그 자동 매칭
├── jvd_prices_20260528_1007.csv  # JVD 크롤링 결과
└── 아리코_유통통합플랫폼_기획서.md  # 원본 기획서
```
