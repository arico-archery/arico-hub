# scripts/legacy

로컬 **SQLite 시대**에 사용한 Python 크롤러·데이터 유틸 모음. 참고용으로 보관합니다.

> ⚠️ 이 스크립트들은 `sqlite3`로 `prisma/dev.db`에 직접 접근합니다. 현재 DB는 **PostgreSQL**이므로 그대로는 동작하지 않습니다. 데이터 임포트는 앱 내 설정 페이지의 CSV/Excel 임포트(`/api/import`)를 사용하세요.

| 파일 | 용도 |
|------|------|
| `match_catalog.py` / `match_catalog.js` | ARICO 카탈로그 ↔ 공급사 상품 매칭(현재는 `/api/auto-match`로 대체) |
| `import_sibuya_shop.py` | SIBUYA 상품 임포트 |
| `collect_arico_images.py` | ARICO 자사몰 상품 대표 이미지 수집 |
| `capture_manual_shots.py` | 매뉴얼용 화면 스크린샷 캡처(Playwright) — `public/manual/*.png` |
| `cleanup_sim.py` | 시뮬레이션/데모 주문 데이터(`SIM-` 접두어) 정리 |

기존 로컬 SQLite 데이터를 Postgres로 옮기려면 루트의 `scripts/migrate-sqlite-to-postgres.mjs`(= `npm run migrate:data`)를 사용하세요.
