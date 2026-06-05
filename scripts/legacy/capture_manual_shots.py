# -*- coding: utf-8 -*-
"""매뉴얼용 실제 화면 스크린샷 캡처 → public/manual/*.png"""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "public/manual"
os.makedirs(OUT, exist_ok=True)

SHOTS = [
    ("dashboard.png", "/", None),
    ("products.png", "/products", None),
    ("backorders.png", "/backorders", None),
    ("po-detail.png", "/purchase-orders/8", None),     # 데모 PO (스텝퍼·재고확인·매입지급)
    ("orders.png", "/orders", None),
    ("payments.png", "/payments", "purchase"),          # 매입 탭 클릭
    ("document.png", "/documents/invoice/48?lang=ko", None),
]

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1360, "height": 860}, device_scale_factor=1)
        for name, path, action in SHOTS:
            pg.goto(BASE + path, wait_until="networkidle")
            pg.wait_for_timeout(1500)
            if action == "purchase":
                try:
                    pg.get_by_role("button", name="매입 (제조사 지급)").click(timeout=3000)
                    pg.wait_for_timeout(900)
                except Exception as e:
                    print("  tab click skip:", e)
            full = name in ("document.png",)
            pg.screenshot(path=os.path.join(OUT, name), full_page=full)
            print("saved", name)
        b.close()

if __name__ == "__main__":
    main()
