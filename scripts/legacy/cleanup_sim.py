# -*- coding: utf-8 -*-
"""시뮬레이션 데이터(SIM-) 일괄 삭제 — 원래 상태로 복구."""
import sqlite3
DB = "prisma/dev.db"

def main():
    con = sqlite3.connect(DB); cur = con.cursor()
    # SIM 주문 → 주문품목 삭제
    cur.execute('SELECT id FROM "Order" WHERE orderNo LIKE "SIM-%"')
    oids = [r[0] for r in cur.fetchall()]
    for oid in oids:
        cur.execute('DELETE FROM OrderItem WHERE orderId=?', (oid,))
    cur.execute('DELETE FROM "Order" WHERE orderNo LIKE "SIM-%"')
    # 시뮬로 생성된 발주서(PO-20260605-*) 삭제
    cur.execute('SELECT id FROM PurchaseOrder WHERE poNo LIKE "PO-20260605-%"')
    pids = [r[0] for r in cur.fetchall()]
    for pid in pids:
        cur.execute('DELETE FROM PurchaseOrderItem WHERE purchaseOrderId=?', (pid,))
    cur.execute('DELETE FROM PurchaseOrder WHERE poNo LIKE "PO-20260605-%"')
    # SIM 상품/재고/거래처 삭제
    cur.execute('SELECT id FROM Product WHERE productCode LIKE "SIM-P%"')
    prod_ids = [r[0] for r in cur.fetchall()]
    for p in prod_ids:
        cur.execute('DELETE FROM StockLevel WHERE productId=?', (p,))
    cur.execute('DELETE FROM Product WHERE productCode LIKE "SIM-P%"')
    cur.execute('DELETE FROM Customer WHERE code LIKE "SIMC-%"')
    con.commit()
    print(f'삭제: 주문 {len(oids)} · 발주 {len(pids)} · 상품 {len(prod_ids)} · 거래처(SIMC-)')
    con.close()

if __name__ == '__main__':
    main()
