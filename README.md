# ARICO Distribution Hub

양궁 장비 **유통 통합 관리 플랫폼**. 여러 공급처(메이커)에서 상품을 받아 일본 고객에게 판매하는 유통 업무 전체 — **상품·주문·발주·재고확인·매입지급·입고·발송·입금·문서 발급** — 을 하나의 웹앱에서 관리합니다.

- 기준 통화: **JPY(¥)**
- UI 언어: **한국어 / 日本語** 토글 (Alt+L)
- 앱 내 사용 매뉴얼: 로그인 후 좌측 메뉴 **사용 메뉴얼**(`/manual`)

> 인앱 매뉴얼이 화면별 사용법을 그림과 함께 안내합니다. 이 README는 **개발자·배포** 용입니다.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) + React 19 |
| 스타일 | TailwindCSS 4 |
| DB | PostgreSQL (Prisma ORM) — *프로덕션: Supabase* |
| 인증 | 경량 세션(HMAC 서명 쿠키) + 미들웨어 |
| 배포 | Vercel |
| 아이콘 | lucide-react |

> 데이터 모델·업무 흐름·핵심 모듈 설명은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 참고.

---

## 로컬 개발 환경 설정

### 1. 클론 & 설치
```bash
git clone <repo-url>
cd arico-hub
npm install
```

### 2. 데이터베이스 준비 (PostgreSQL)
[Supabase](https://supabase.com)에서 무료 프로젝트를 만들거나 로컬 Postgres를 사용합니다.
- Supabase: Project Settings → Database → **Connection string** 에서 Pooled(6543) / Direct(5432) URL 확보.

### 3. 환경변수
```bash
cp .env.example .env
```
`.env`를 열어 값을 채웁니다:

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | 런타임용 Postgres URL (Supabase pooler, 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | 마이그레이션/`db push`용 Direct URL (5432) |
| `APP_PASSWORD` | 앱 접속 비밀번호 (로그인) |
| `AUTH_SECRET` | 세션 쿠키 서명 비밀키 (`openssl rand -hex 32`) |

> 로컬에서 `APP_PASSWORD`/`AUTH_SECRET`를 비워두면 **인증이 비활성**되어 바로 접근됩니다(개발 편의).

### 4. 스키마 적용 & 시드
```bash
npm run db:push      # Postgres에 테이블 생성 (Prisma 스키마 동기화)
npm run db:seed      # 공급처 8개·환율·샘플 상품/거래처 시드
```

### 5. 실행
```bash
npm run dev          # http://localhost:3000
```

---

## 데이터 채우기 (실데이터)

시드는 동작 확인용 최소 데이터만 넣습니다. 실제 상품 데이터는 다음으로 채웁니다:

- **앱 내 임포트** — 설정(`/settings`) 페이지에서 공급사별 CSV/Excel 가격표 업로드(템플릿 제공). `/api/import`가 처리.
- **기존 로컬 SQLite 데이터 이전(1회)** — 예전 SQLite(`prisma/dev.db`)에 데이터가 있다면:
  ```bash
  npm run db:push                       # Postgres 테이블 준비
  npm run migrate:data                  # dev.db → Postgres 일괄 이전
  ```
  (`scripts/migrate-sqlite-to-postgres.mjs`)

> `scripts/legacy/`의 Python 스크립트는 **로컬 SQLite 시대의 크롤러·유틸**입니다. 현재 Postgres 기준에선 참고용이며, 데이터 임포트는 앱 내 임포터를 사용하세요.

---

## npm 스크립트

| 명령 | 설명 |
|------|------|
| `npm run dev` | 개발 서버 |
| `npm run build` | `prisma generate` + 프로덕션 빌드 |
| `npm run start` | 프로덕션 서버 |
| `npm run lint` | ESLint |
| `npm run db:push` | Prisma 스키마 → DB 동기화 |
| `npm run db:seed` | 시드 데이터 입력 |
| `npm run db:studio` | Prisma Studio (DB GUI) |
| `npm run migrate:data` | 로컬 SQLite → Postgres 데이터 이전(1회) |

---

## 배포 (Vercel + Supabase)

1. **Supabase**: 프로젝트 생성 → Pooled/Direct 연결문자열 확보.
2. **GitHub**: 이 저장소를 push.
3. **Vercel**: GitHub 저장소 임포트 → **Environment Variables** 에 다음 설정:
   - `DATABASE_URL`, `DIRECT_URL`, `APP_PASSWORD`, `AUTH_SECRET`
4. **스키마 적용(1회)**: 로컬에서 `.env`의 URL을 Supabase로 둔 채 `npm run db:push` 실행(또는 Vercel 빌드에 push 단계 추가).
5. **Deploy**: 빌드 명령은 기본(`npm run build`)을 사용. 배포 후 접속 → 로그인(`APP_PASSWORD`).

> 빌드는 `prisma generate && next build`. 대부분의 페이지가 동적/클라이언트라 빌드 시 DB 접속이 필요 없습니다.

---

## 인증

- 미설정(로컬) 시 통과, 설정 시 **모든 경로 보호**.
- `/login`에서 `APP_PASSWORD` 입력 → HMAC 서명된 httpOnly 세션 쿠키 발급(7일).
- 구현: `src/middleware.ts`, `src/lib/auth.ts`, `src/app/api/auth/*`, `src/app/login/page.tsx`.
- 다중 사용자·역할이 필요하면 NextAuth(Credentials/OAuth)로 확장 가능.

---

## 폴더 구조 (요약)

```
src/
  app/
    (dashboard)/        # 인증 보호 영역 (사이드바 레이아웃)
      page.tsx          # 대시보드
      products/ catalog/ orders/ backorders/ purchase-orders/
      payments/ customers/ analytics/ exchange-rates/ settings/ manual/
    documents/[type]/[id]/   # 청구서·견적서·발주서 (일·한·영)
    api/                # API 라우트 (orders, purchase-orders, dashboard, analytics, import, auth ...)
    login/              # 로그인 페이지
  components/           # Sidebar, Logo, SupplierBadge, ProfitBar, DateInput
  lib/                  # utils(calcCostJpy), prisma, i18n, translations, auth, documents
prisma/                 # schema.prisma, seed.ts
docs/                   # ARCHITECTURE.md
scripts/                # migrate-sqlite-to-postgres.mjs, legacy/(Python 유틸)
public/manual/          # 매뉴얼 스크린샷
```

자세한 내용은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), 그리고 작업 이력은 [`CLAUDE.md`](CLAUDE.md) 참고.
