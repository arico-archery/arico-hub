# -*- coding: utf-8 -*-
"""ARICO 자사몰(MakeShop) 카탈로그 상품의 실제 대표 이미지 URL을 수집해서 DB에 채운다.
기존 image_url_1 은 사이트 로고(logo.png)만 들어있어 무의미 → 진짜 상품 이미지로 교체.
상품 페이지 SSR HTML에서 makeshop-multi-images 도메인의 대표 이미지를 추출한다.
"""
import sqlite3
import re
import sys
import time
import requests

DB = "prisma/dev.db"
IMG_RE = re.compile(
    r"https://makeshop-multi-images\.akamaized\.net/[^\"'\s)]+?\.(?:jpg|jpeg|png|gif)",
    re.I,
)

def pick_main_image(html: str) -> str:
    urls = IMG_RE.findall(html)
    if not urls:
        return ""
    # 중복 제거(순서 유지)
    seen, uniq = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    # "1_" 대표 이미지를 우선, 없으면 첫 번째
    for u in uniq:
        if re.search(r"/1_[^/]+$", u):
            return u
    return uniq[0]

def main():
    only_missing = "--all" not in sys.argv
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT id, product_code, url, image_url_1 FROM arico_catalog ORDER BY id")
    rows = cur.fetchall()
    sess = requests.Session()
    sess.headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"

    updated = empty = skipped = errors = 0
    total = len(rows)
    for i, (cid, code, url, img1) in enumerate(rows, 1):
        # 이미 진짜 이미지(로고 아님)면 스킵
        if only_missing and img1 and "logo.png" not in img1:
            skipped += 1
            continue
        if not url:
            url = f"https://www.arico-archery.com/view/item/{code}"
        try:
            r = sess.get(url, timeout=20)
            main_img = pick_main_image(r.text)
        except Exception as e:
            errors += 1
            print(f"[ERR] {code}: {e}")
            continue
        if main_img:
            cur.execute(
                "UPDATE arico_catalog SET image_url_1 = ? WHERE id = ?",
                (main_img, cid),
            )
            updated += 1
        else:
            # 상품 이미지가 없으면 로고 제거(빈 값) → UI에서 플레이스홀더 표시
            cur.execute(
                "UPDATE arico_catalog SET image_url_1 = '' WHERE id = ?",
                (cid,),
            )
            empty += 1
        if i % 25 == 0:
            con.commit()
            print(f"  {i}/{total}  updated={updated} empty={empty} skip={skipped} err={errors}")
        time.sleep(0.05)

    con.commit()
    con.close()
    print(f"DONE  updated={updated} empty={empty} skipped={skipped} errors={errors} / total={total}")

if __name__ == "__main__":
    main()
