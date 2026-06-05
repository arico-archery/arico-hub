"""
SIBUYA 쇼핑몰 상품 데이터 임포트 스크립트
CSV 컬럼: 商品ID, 部門ID, 部門名, 商品コード, 商品名, 商品単価, サイズ, カラー, 原価, 在庫, 品番

사용법:
  python import_sibuya_shop.py 商品データ.csv [--dry-run]
"""

import csv
import sys
import os
import re
import sqlite3
from pathlib import Path

# ── 설정 ──────────────────────────────────────────
DB_PATH = Path(__file__).parent / "prisma" / "dev.db"
SUPPLIER_CODE = "SIBUYA"

# 폐반/단종 접두사 패턴 (가격=0 이거나 이름에 포함된 경우)
DISCONTINUED_PREFIXES = ("【廃版】", "【廃盤】", "【廃止】")

# ── 브랜드 추출 ──────────────────────────────────
KNOWN_BRANDS = [
    "HOYT", "FIVICS", "WIAWIS", "Mathews", "MK", "EASTON",
    "WIN&WIN", "Beiter", "PSE", "SHIBUYA", "SHIBUYA ARCHERY",
    "AAE", "AXCEL", "ANGEL", "KOREA", "ARICO", "SHREWD",
    "PSE", "Diamond", "BOWTECH", "Bear", "SEBASTIAN FLUTE",
    "BLACKSHEEP", "CARTEL", "DOINKER", "CAVALIER", "SURE-LOC",
    "TORAY", "GOLD TIP", "CARBON EXPRESS", "BLACK EAGLE",
    "NEET", "BJARNE", "SPIGARELLI", "TIGHTSPOT", "CamX",
    "SKY ARCHERY", "CORE", "AVALON", "GILLO", "LANCIO",
    "DECUT", "COPPER JOHN", "GAS PRO", "NAP", "TROPHY RIDGE",
    "HAMSKEA", "QAD", "RIPCORD", "VAPOR TRAIL", "TROPHY TAKER",
    "SPOT HOGG", "PINE RIDGE", "GAME TRACKER", "MUZZY",
    "APEX GEAR", "TROPHY RIDGE", "BEE STINGER", "SKYLINE",
]

def extract_brand(name: str) -> str:
    """상품명 첫 단어에서 브랜드 추출"""
    # 폐반 태그 제거
    clean = re.sub(r'【[^】]*】', '', name).strip()
    for brand in sorted(KNOWN_BRANDS, key=len, reverse=True):
        if clean.upper().startswith(brand.upper()):
            return brand
    # 첫 단어 사용
    parts = clean.split()
    return parts[0] if parts else "UNKNOWN"

def extract_category(dept_name: str) -> str:
    """部門名에서 카테고리 추출 (슬래시 앞 부분)"""
    return dept_name.split("/")[0].strip() if "/" in dept_name else dept_name.strip()

def is_discontinued(row: list) -> bool:
    """폐반/단종 상품 여부"""
    name = row[4]
    for prefix in DISCONTINUED_PREFIXES:
        if name.startswith(prefix):
            return True
    return False

def normalize_code(raw_code: str) -> str:
    """JAN 코드 정규화 (과학적 표기 → 정수 → 문자열)"""
    try:
        val = float(raw_code)
        return str(int(val))
    except (ValueError, OverflowError):
        return raw_code.strip()

def main():
    if len(sys.argv) < 2:
        print("사용법: python import_sibuya_shop.py <CSV파일> [--dry-run]")
        sys.exit(1)

    csv_file = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    if not Path(csv_file).exists():
        print(f"파일 없음: {csv_file}")
        sys.exit(1)

    print(f"📂 파일: {csv_file}")
    print(f"🗄️  DB: {DB_PATH}")
    if dry_run:
        print("🔍 DRY RUN 모드 (실제 저장 없음)")
    print()

    # CSV 읽기 (Shift-JIS)
    with open(csv_file, encoding="shift_jis", errors="replace") as f:
        rows = list(csv.reader(f))

    header = rows[0]
    data = rows[1:]
    print(f"전체 행: {len(data):,}개")

    # 폐반 제외
    active = [r for r in data if not is_discontinued(r)]
    discontinued = len(data) - len(active)
    print(f"폐반/단종 제외: {discontinued}개 → 활성 상품: {len(active):,}개")

    # 가격 0인 상품 제외 (샘플 데이터 등)
    active = [r for r in active if r[5].strip() and float(r[5]) > 0]
    print(f"가격 0 제외 후: {len(active):,}개")
    print()

    if dry_run:
        # 샘플 5개 출력
        print("=== 임포트 예정 샘플 ===")
        for r in active[:5]:
            brand = extract_brand(r[4])
            cat = extract_category(r[2])
            print(f"  [{r[0]}] {r[4]}")
            print(f"       브랜드:{brand} | 카테고리:{cat} | 단가:{r[5]}엔 | 사이즈:{r[6]} | 컬러:{r[7]}")
        print(f"\n(총 {len(active):,}개 임포트 예정)")
        return

    # DB 연결
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 기존 SIBUYA shop 임포트 상품 (shopProductId가 있는 것) 가져오기
    cur.execute("SELECT shopProductId FROM Product WHERE supplierCode=? AND shopProductId != ''", (SUPPLIER_CODE,))
    existing_shop_ids = {row[0] for row in cur.fetchall()}
    print(f"기존 shop 임포트 상품: {len(existing_shop_ids)}개")

    inserted = 0
    updated = 0
    skipped = 0

    for row in active:
        shop_id     = row[0].strip()          # 商品ID
        dept_name   = row[2].strip()          # 部門名
        raw_code    = row[3].strip()          # 商品コード
        name        = row[4].strip()          # 商品名
        price_str   = row[5].strip()          # 商品単価
        size        = row[6].strip()          # サイズ
        color       = row[7].strip()          # カラー
        stock_str   = row[9].strip()          # 在庫

        try:
            cost_price = float(price_str)
        except ValueError:
            skipped += 1
            continue

        brand     = extract_brand(name)
        category  = extract_category(dept_name)
        jan_code  = normalize_code(raw_code)
        # ARICO 시스템 내 고유 상품코드: "SBY-{商品ID}"
        product_code = f"SBY-{shop_id}"

        try:
            stock = int(float(stock_str)) if stock_str else 0
        except ValueError:
            stock = 0

        if shop_id in existing_shop_ids:
            # 업데이트 (가격, 옵션 정보 갱신)
            cur.execute("""
                UPDATE Product
                SET name=?, costPrice=?, optionSize=?, optionColor=?,
                    brand=?, category=?, updatedAt=datetime('now')
                WHERE shopProductId=? AND supplierCode=?
            """, (name, cost_price, size, color, brand, category, shop_id, SUPPLIER_CODE))
            updated += 1
        else:
            # 신규 삽입
            cur.execute("""
                INSERT OR IGNORE INTO Product
                (supplierCode, productCode, name, brand, category,
                 costPrice, msrp, unit, availability,
                 optionSize, optionColor, shopProductId,
                 imageUrl1, imageUrl2, imageUrl3, url,
                 salePriceJpy, jvdMatchCode, createdAt, updatedAt)
                VALUES (?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?,?,datetime('now'),datetime('now'))
            """, (
                SUPPLIER_CODE, product_code, name, brand, category,
                cost_price, cost_price, "1", "in_stock",
                size, color, shop_id,
                "", "", "", "",
                0, "",
            ))
            if cur.rowcount > 0:
                inserted += 1
                # StockLevel 도 생성
                prod_id = cur.lastrowid
                if prod_id and stock != 0:
                    cur.execute("""
                        INSERT OR IGNORE INTO StockLevel (productId, quantity, reservedQty, reorderPoint, updatedAt)
                        VALUES (?,?,0,0,datetime('now'))
                    """, (prod_id, max(0, stock)))
            else:
                skipped += 1

        if (inserted + updated) % 1000 == 0 and (inserted + updated) > 0:
            print(f"  진행중... {inserted+updated:,}건 처리")
            conn.commit()

    conn.commit()
    conn.close()

    print()
    print("=" * 50)
    print(f"✅ 임포트 완료!")
    print(f"   신규 추가: {inserted:,}개")
    print(f"   업데이트:  {updated:,}개")
    print(f"   스킵:      {skipped:,}개")
    print("=" * 50)


if __name__ == "__main__":
    main()
