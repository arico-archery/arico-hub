# 01. システム全体像と業務の流れ

> 引き継ぎ資料。開発担当（と Claude）が最初に把握すべき全体像。
> 最終更新: 2026-08-11 / v1.90.0

---

## 1. このアプリが解決している問題

アーチェリー用品の卸・小売業。**仕入先が11社あり、通貨も価格の意味もバラバラ**（USD の B2B 価格、
円の希望小売価格、税抜価格…）。さらに販売経路が3つある（自社EC・請求書取引・店頭）。
これを一箇所に集めて「いくらで仕入れて、いくらで売って、いくら残ったか」を出すのがこのアプリ。

### 3つの販売経路（`src/lib/order-channel.ts` で判定）

| 経路 | 判定方法 | 説明 |
|---|---|---|
| 自社EC | `externalOrderNo` あり（`INV-` 以外） | MakeShop から自動取込 |
| 請求書 | `externalOrderNo` が `INV-` で始まる | オフラインの請求書取引（2026年1〜7月分を一括投入済み） |
| 手書き | `externalOrderNo` が空 | 画面から手入力した受注 |

`Order.internal = true` は**自社在庫の確保用**の受注で、売上・債権・分析からは除外される。

---

## 2. 受注から入金までの流れ

```
受注（EC取込 / 手入力 / 請求書）
  ↓
在庫充当の判定 … スマレジ在庫があれば発注せずそのまま出す（stockAllocated=true）
  ↓ 在庫が無い分だけ
バックオーダー（procureStatus = needed）
  ↓ 仕入先ごとにまとめて
発注書 PO 発行（ordered）→ メーカー在庫確認 → 仕入支払 → 入荷（received）
  ↓
発送（Shipment：分割発送可・回数ごとに送り状）
  ↓ 全数発送で自動的に
完了（delivered + completedAt）
  ↓
入金消込（payments 画面）
```

### 品目の調達状態 `OrderItem.procureStatus`
`needed`（未発注）→ `ordered`（発注済）→ `received`（入荷済）

### 在庫充当 `src/lib/stock-allocate.ts`
スマレジ在庫で賄える分は発注しない。**二重引き当てを防ぐため**「充当済みだが未発送の数量」を
在庫から引いた値を可用在庫とする。
⚠️ **受注を受けた時点の判定しかしない**。後から在庫が入っても再判定されない（→ `05-open-issues.md`）。

---

## 3. 分割発送（Shipment / ShipmentItem）

2026-08-06 導入。それまでは受注に発送日・送り状が1つずつしか持てなかった。

- `Shipment`（orderId, shipNo, shippingDate, trackingNo, memo）＋ `ShipmentItem`（orderItemId, quantity）
- 回数ごとに納品書を発行できる: `/documents/delivery/[id]?ship=<shipmentId>`
- **全数発送されると自動で完了**（status=delivered, completedAt, deliveryDate をセット）
- 受注の `shippingDate` / `trackingNo` は**最新回の値**を保持（既存画面との互換のため）

---

## 4. 帳票（`/documents/[type]/[id]`）

`quote`（見積書）`invoice`（請求書）`delivery`（納品書）`receipt`（領収書）`po`（発注書）の5種。
画面上のツールバーで相互に切り替えられ、日本語/韓国語も切替可能。

| クエリ | 効果 |
|---|---|
| `?lang=ja` / `ko` | 表示言語 |
| `?np=1` | 金額を非表示 |
| `?zan=1` | 注残（バックオーダー残）を併記 |
| `?ship=<id>` | その発送回の納品書（未発送分・発送済分も注記） |

- 品名は `OrderItem.shopProductName`（顧客が実際に注文した自社EC上の商品名）を優先表示。
  帳票上で直接編集できる（`EditableName`）。仕入先商品名は一般名なので顧客向けには不適切なため。
- 注残は `Order.zanText` に手書き、または自動取得。備考は `Order.memo`、領収書の但し書きは `Order.receiptNote`。
- 領収書は**入金額基準**。5万円以上は収入印紙欄が出る。

---

## 5. カタログ（`/catalog`）— このアプリの心臓部

`AricoCatalog` = 自社EC の商品一覧。各行が `supplierProductId` で**仕入先商品にリンク**している。
このリンクが原価の源泉なので、**リンクが間違っていると利益計算が全部狂う**。

- 自動マッチングは**廃止済み**（精度が出ず、特に左右 RH/LH の取り違えが致命的だったため）。
  現在は**手動マッチング**と、**受注時に人が選んだ組み合わせの学習**のみ。
- マッチング画面には仕入先フィルタのチップがある（同名商品が複数社に跨るため）。
- FIVICS は変形（バリエーション）を親商品にまとめており、カタログは親（`variantParent`）にリンクする。

### ⚠️ カタログを直しても既存の受注は変わらない
`OrderItem` は**原価のスナップショット**。カタログのリンクを直したら、
遡及適用スクリプト（過去に `_repoint-all.mjs` として実施）で
品目の `productId`・`costPriceJpy` を貼り替え、受注の `totalCostJpy` を再計算する必要がある。
遡及すると**過去月の損益が変わる**ので、実行前に必ず依頼者に確認すること。

---

## 6. データ整備スクリプトの作法（このプロジェクトの慣習）

一括データ修正は以下の手順で行ってきた。踏襲することを推奨する。

1. `.mjs` スクリプトをリポジトリ**外**（`請求書 임포트/` フォルダ）に作る … 顧客の個人情報を含むため git に入れない
2. リポジトリにコピーして `node xxx.mjs` で**プレビュー実行**（何件がどう変わるか出力）
3. 依頼者の確認後 `node xxx.mjs --apply`
4. **適用前に undo ログ（`_xxx-applied.json`）を書く**（log-first）
5. 実行後スクリプトを削除し、`git status` で残っていないか確認

---

## 7. 用語対応表（韓/日/英）

| 日本語 | 韓国語 | コード上の名前 |
|---|---|---|
| 受注 | 주문 | Order |
| 発注 | 발주 | PurchaseOrder (PO) |
| 取引先 | 거래처 | Customer |
| 仕入先 | 공급사 | Supplier |
| バックオーダー | 백오더 | procureStatus = needed/ordered |
| 原価 | 원가 | costPriceJpy |
| 在庫充当 | 재고 충당 | stockAllocated |
| 注残 | 백오더 잔량 | zanText |
