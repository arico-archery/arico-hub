"""
ARICO 카탈로그 → 공급사 상품 자동 매칭 스크립트

브랜드 매핑 규칙:
  MK KOREA / MK       → MK
  FIVICS              → FIVICS
  ANGEL               → ANGEL
  WJ SPORTS / WJ      → WJ
  KOREA ARCHERY / KOREA → KOREA
  SHIBUYA / SIBUYA    → SIBUYA
  그 외 (HOYT, EASTON, WIN&WIN 등) → JVD

사용법:
  python match_catalog.py [--dry-run] [--threshold 0.5] [--supplier FIVICS]
"""

import sqlite3
import re
import unicodedata
import sys
from difflib import SequenceMatcher
from collections import defaultdict
from pathlib import Path

DB_PATH = Path(__file__).parent / "prisma" / "dev.db"

# ── 브랜드 → 공급사 코드 매핑 ───────────────────────────────
BRAND_TO_SUPPLIER = {
    # MK
    'MK KOREA': 'MK', 'MK': 'MK',
    # FIVICS
    'FIVICS': 'FIVICS',
    # ANGEL
    'ANGEL': 'ANGEL',
    # WJ
    'WJ SPORTS': 'WJ', 'WJ SPORT': 'WJ', 'WJ SPORT COUCH': 'WJ',
    'WJ': 'WJ', 'WNS': 'WJ',
    # KOREA
    'KOREA ARCHERY': 'KOREA', 'KOREA ARCHERY JET': 'KOREA', 'KOREA ARCHERY JET': 'KOREA',
    'KOREA': 'KOREA', 'KOREA SPORTS': 'KOREA',
    # SIBUYA
    'SHIBUYA': 'SIBUYA', 'SIBUYA': 'SIBUYA', 'SHIBUYA ARCHERY': 'SIBUYA',
    # 기타 → JVD
    'HOYT': 'JVD', 'WIN&WIN': 'JVD', 'WIAWIS': 'JVD', 'EASTON': 'JVD',
    'BEITER': 'JVD', 'AAE': 'JVD', 'CARTEL': 'JVD', 'AXCEL': 'JVD',
    'BLACK SHEEP': 'JVD', 'BLACKSHEEP': 'JVD', 'AVALON': 'JVD',
    'RANGE-O-MATIC': 'JVD', 'DOINKER': 'JVD', 'DECUT': 'JVD',
    'SPOT HOGG': 'JVD', 'SWA': 'JVD', 'BOHNING': 'JVD',
    'GAS BOWSTRINGS': 'JVD', 'FLEX-FLETCH': 'JVD',
    'COMPETITION AP': 'JVD', 'ZEILO': 'FIVICS',
    'ARICO': 'JVD', 'ARICO STRING': 'JVD',
}

# 이름에서 공급사를 추측하는 키워드 (브랜드 없는 경우)
NAME_BRAND_KEYWORDS = [
    ('HOYT',      'JVD'), ('WIN&WIN',  'JVD'), ('WIAWIS',   'JVD'),
    ('EASTON',    'JVD'), ('BEITER',   'JVD'), ('AAE',      'JVD'),
    ('AXCEL',     'JVD'), ('CARTEL',   'JVD'), ('DOINKER',  'JVD'),
    ('AVALON',    'JVD'), ('DECUT',    'JVD'), ('PSE',      'JVD'),
    ('FIVICS',    'FIVICS'), ('ZEILO', 'FIVICS'),
    ('SHIBUYA',   'SIBUYA'), ('SIBUYA', 'SIBUYA'),
    ('KOREA ARCHERY', 'KOREA'), ('KOREA SPORTS', 'KOREA'),
    ('MK KOREA',  'MK'), ('MK ZX',    'MK'), ('MK XG',    'MK'),
    ('ANGEL',     'ANGEL'),
    ('WJ SPORTS', 'WJ'),  ('WNS',     'WJ'),
]

def normalize(s: str) -> str:
    """소문자 + 공백/특수문자 제거 + 전각→반각"""
    if not s:
        return ''
    # 전각 → 반각
    s = unicodedata.normalize('NFKC', s)
    # 괄호 안 내용 제거 (사이즈 정보 등)
    s = re.sub(r'[（(][^）)]*[）)]', ' ', s)
    # 특수문자 → 공백
    s = re.sub(r'[_\-/,\.&]', ' ', s)
    # 다중 공백 → 단일
    s = re.sub(r'\s+', ' ', s).strip()
    return s.lower()

def keywords(name: str) -> set:
    """이름에서 의미 있는 키워드 추출 (길이 2 이상)"""
    words = normalize(name).split()
    return {w for w in words if len(w) >= 2}

def similarity(a: str, b: str) -> float:
    """두 문자열 유사도 (0~1)"""
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    # 완전 포함 체크
    if na in nb or nb in na:
        return 0.75
    # SequenceMatcher
    seq = SequenceMatcher(None, na, nb).ratio()
    # 키워드 교집합 비율
    ka, kb = keywords(a), keywords(b)
    if ka and kb:
        overlap = len(ka & kb) / min(len(ka), len(kb))
        return max(seq, overlap)
    return seq

def detect_supplier(brand: str, name: str) -> str:
    """브랜드/이름에서 공급사 코드 추론"""
    b = brand.upper().strip() if brand else ''
    # 직접 매핑
    if b in BRAND_TO_SUPPLIER:
        return BRAND_TO_SUPPLIER[b]
    # 부분 매핑
    for key, sup in BRAND_TO_SUPPLIER.items():
        if key in b:
            return sup
    # 이름에서 키워드 검색
    name_upper = name.upper()
    for kw, sup in NAME_BRAND_KEYWORDS:
        if kw in name_upper:
            return sup
    # 기본값: JVD
    return 'JVD'

def main():
    dry_run   = '--dry-run' in sys.argv
    threshold = 0.4
    filter_sup = None

    for i, arg in enumerate(sys.argv[1:]):
        if arg == '--threshold' and i + 1 < len(sys.argv) - 1:
            threshold = float(sys.argv[i + 2])
        if arg == '--supplier' and i + 1 < len(sys.argv) - 1:
            filter_sup = sys.argv[i + 2].upper()

    if dry_run:
        print("🔍 DRY RUN 모드 (실제 저장 없음)")
    print(f"📊 유사도 임계값: {threshold}")
    if filter_sup:
        print(f"🔧 공급사 필터: {filter_sup}")
    print()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ── 카탈로그 아이템 로드 ─────────────────────────────────
    cur.execute("SELECT id, product_code, brand, name FROM arico_catalog WHERE supplier_product_id IS NULL")
    catalog_items = cur.fetchall()
    print(f"매칭 대상 카탈로그 아이템: {len(catalog_items)}개")

    # ── 공급사별 상품 로드 ────────────────────────────────────
    cur.execute("SELECT id, supplierCode, productCode, name, brand FROM Product")
    all_products = cur.fetchall()

    products_by_supplier = defaultdict(list)
    for p in all_products:
        products_by_supplier[p['supplierCode']].append(p)

    for sup, prods in products_by_supplier.items():
        print(f"  {sup}: {len(prods)}개 상품")
    print()

    # ── 매칭 ─────────────────────────────────────────────────
    matched_count  = 0
    skipped_count  = 0
    low_score_count = 0

    results_by_supplier = defaultdict(list)

    for item in catalog_items:
        cat_id   = item['id']
        cat_code = item['product_code'] or ''
        cat_brand = item['brand'] or ''
        cat_name  = item['name'] or ''

        # 공급사 결정
        supplier = detect_supplier(cat_brand, cat_name)
        if filter_sup and supplier != filter_sup:
            continue

        # 후보 상품 목록
        candidates = products_by_supplier.get(supplier, [])
        if not candidates:
            skipped_count += 1
            continue

        # SIBUYA: SBY- 코드 상품 우선 (쇼핑몰 임포트)
        if supplier == 'SIBUYA':
            shop_prods = [p for p in candidates if p['productCode'].startswith('SBY-')]
            if shop_prods:
                candidates = shop_prods

        # 최고 유사도 찾기
        best_score = 0.0
        best_prod  = None

        # 1단계: 상품 코드 직접 매칭
        cat_code_clean = re.sub(r'^0+', '', cat_code)  # 선행 0 제거
        for p in candidates:
            pc = re.sub(r'^0+', '', p['productCode'] or '')
            if cat_code_clean and pc and cat_code_clean == pc:
                best_prod  = p
                best_score = 1.0
                break

        # 2단계: 이름 유사도 매칭
        if best_score < 1.0:
            for p in candidates:
                score = similarity(cat_name, p['name'] or '')
                if score > best_score:
                    best_score = score
                    best_prod  = p

        if best_prod and best_score >= threshold:
            results_by_supplier[supplier].append({
                'cat_id':    cat_id,
                'cat_code':  cat_code,
                'cat_name':  cat_name[:50],
                'prod_id':   best_prod['id'],
                'prod_code': best_prod['productCode'],
                'prod_name': (best_prod['name'] or '')[:50],
                'score':     best_score,
            })
            matched_count += 1
        else:
            low_score_count += 1

    # ── 결과 출력 ─────────────────────────────────────────────
    total_found = sum(len(v) for v in results_by_supplier.values())
    print(f"✅ 매칭 성공: {total_found}개")
    print(f"⚠️  낮은 유사도로 스킵: {low_score_count}개")
    print(f"🚫 공급사 상품 없어 스킵: {skipped_count}개")
    print()

    for sup in sorted(results_by_supplier.keys()):
        items = results_by_supplier[sup]
        print(f"── {sup} ({len(items)}개) ────────────────────")
        for r in items[:5]:
            print(f"  [{r['score']:.2f}] {r['cat_name']}")
            print(f"       → {r['prod_name']} ({r['prod_code']})")
        if len(items) > 5:
            print(f"  ... 외 {len(items)-5}개")
        print()

    if dry_run:
        print("(DRY RUN — 저장 생략)")
        conn.close()
        return

    # ── 저장 ─────────────────────────────────────────────────
    saved = 0
    for items in results_by_supplier.values():
        for r in items:
            cur.execute(
                "UPDATE arico_catalog SET supplier_product_id=?, updated_at=datetime('now') WHERE id=?",
                (r['prod_id'], r['cat_id'])
            )
            saved += 1

    conn.commit()
    conn.close()

    print(f"💾 DB 저장 완료: {saved}개 매칭")

if __name__ == '__main__':
    main()
