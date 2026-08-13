# 02. MakeShop（自社EC）連携

> 稼働中。受注・会員の取込が本番運用されている。
> API 仕様の詳細は `docs/makeshop-integration.md`（韓国語）にある。
> 最終更新: 2026-08-11

---

## 1. 接続

- エンドポイント: `https://app-api.makeshop.jp/v1/graphql`（アプリID 455）
- 認証ヘッダ: `authorization: Bearer <PATトークン>` + `x-api-key` + `x-timestamp`（毎リクエストの unixtime）
- クライアント実装: `src/lib/makeshop.ts`

### 🚨 秘密情報の扱い
`MAKESHOP_GQL_ENDPOINT` / `MAKESHOP_API_TOKEN` / `MAKESHOP_API_KEY` は **Vercel 環境変数のみ**。
コード・git・ローカルの `.env` に置かない。そのため **MakeShop 連携はローカルでテストできない**
（動作確認は Vercel にデプロイして cron エンドポイントを叩く）。

### 🚨 MakeShop アプリをアンインストールしないこと
アンインストールすると PAT トークンが失効し、再連携の申請が必要になる。

### 権限
`getShop` ✅ / `searchOrder` ✅ / `searchMember` ✅ / `searchProduct` ✅（2026-07-16 承認）
/ introspection ❌（FORBIDDEN — スキーマ照会はできないので、フィールド名は試して確かめるしかない）

---

## 2. 受注取込

- 画面: サイドバー「MakeShop 受信」（`/makeshop`）→ プレビュー → 取込実行
- API: `/api/makeshop/import-orders` GET=プレビュー / POST=作成
- **重複防止**: `Order.externalOrderNo`（MakeShop の systemOrderNumber）。何度実行しても二重登録されない
- マッチしない商品は `productCode` ごとに ETC 商品を自動生成 → 受注管理で修正する
- 取込時に在庫充当を判定し、在庫がある分は発注せず `received` + `stockAllocated=true` で作る

### 商品コードの対応
受注品目の `productCode` は12桁の商品番号（例 `000000002443`）で、**`AricoCatalog.productCode` と直接一致する**。
JAN コードを介する必要は無い。

### オプション情報
`basketInfos[].variationCustomCode`（13〜14桁の内部コード）を `OrderItem.optionMemo` に保存している。
人が読める形（色・サイズ）はスマレジ経由で解決し `optionLabel` に入る。
**`optionMemo` は消さないこと**（決定済み）— スマレジの商品コードと突き合わせる鍵になっている。

### 大量取込のタイムアウト対策
Vercel の関数は60秒で切れる。対策として:
- 会員の全件照会を取込処理から除去（会員名は別途「MakeShop会員」同期で補完）
- 受注番号を事前採番して8並列で作成、`maxDuration = 60`
- 期間パラメータ `from` / `to`（YYYYMMDD）で月単位に分割可能

### ログイン無しで叩く（運用者・Claude 用）
```
https://arico-hub.vercel.app/api/cron/import-orders?from=YYYYMMDD&to=YYYYMMDD&token=<TOKEN>
```
`TOKEN` = `hex(HMAC-SHA256(AUTH_SECRET, 'import-orders'))`。ローカルの `.env` の `AUTH_SECRET` から計算する。

---

## 3. 入金状態のマッピング

`paymentStatusCode` の対応（2026-07-15 確定）:

| コード | 意味 | 扱い |
|---|---|---|
| 0000 | 代引き | 入金済 |
| 0001 | 現金 | 入金済 |
| 0002 | 振込 | 入金済 |
| 0004 | 仮売上（顧客決済済・売上未確定） | 入金済 |
| 1002 | ポイント（¥0） | 入金済（債権なし） |
| 0003 | キャンセル | 受注を cancelled にする |
| その他 | | 未入金 |

実装は `import-orders/route.ts` の `PAID_CODES` と `mapPayment()`。
既存受注の是正は `/api/cron/reconcile-payments?from=&to=&token=` で MakeShop から再取得して直せる。

---

## 4. 会員同期（取引先の補完）

- 画面: 取引先管理 →「MakeShop会員」（全件）/「新規のみ」（高速）
- API: `/api/makeshop/sync-members`、cron 版 `/api/cron/sync-members?mode=all&page=N&token=`
- 全件は約2,600名。ページ分割で数分かかる

### 住所フィールドの罠（2026-08-11 解決）
会員の住所は3段に分かれている:
- `haddressAddr` … 都道府県（`東京(23区内)` のように配送区分が括弧で付く → 正式名称に直している）
- `haddress2` … 市区町村まで
- **`haddress`** … 番地・建物名まで入った詳細住所

以前は `haddress2` だけを使っていたため**番地が抜けていた**。現在は3つを結合して重複を除去している
（`memberAddress()`）。⚠️ `haddress` の形は会員によって違う — 東京23区は区名を含み（`港区芝浦4-4-27`）、
それ以外は市の後ろだけ（`小野路町 2566-5`）。だから3段すべてを入れて重複除去に任せる設計になっている。

> `haddress1` は住所ではなく**都道府県コード**（東京23区内=13 など）。使わないこと。

### 退会会員
自社ECを退会すると MakeShop 側の個人情報が消え、**名前欄に会員IDが残る**（現在19件）。
会員同期をかけても埋まらない（元データが無い）。`Customer.withdrawn = true` が立ち、
取引先一覧では既定で非表示。受注履歴が紐づいているので**削除しない**。

---

## 5. 方針

**MakeShop へは受信（pull）のみ**。送り状番号や発送状態を MakeShop に書き戻す（push）機能は
意図的に作っていない。
