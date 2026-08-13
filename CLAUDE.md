@AGENTS.md

# ARICO Distribution Hub — Claude 用プロジェクトガイド

> このファイルは Claude が自動で読み込みます。**まず `HANDOFF.md`（引き継ぎ）と `docs/handoff/` を読んでください。**
> 最終更新: 2026-08-11 / v1.90.0

アーチェリー用品の卸・小売を統合管理する社内 Web アプリ。仕入先11社の原価・受注・発注・入金・請求を一元管理し、
自社EC（MakeShop）と POS（スマレジ）に API 連携している。

---

## 技術スタック（現状）

| 区分 | 内容 |
|---|---|
| フレームワーク | Next.js 16 (App Router) / React 19 / TailwindCSS |
| ORM / DB | Prisma 5.22 / **Supabase PostgreSQL（東京リージョン）** |
| ホスティング | Vercel（無料枠・関数タイムアウト60秒）https://arico-hub.vercel.app |
| リポジトリ | `arico-archery/arico-hub` — **main への push で自動デプロイ** |
| 基準通貨 | **JPY**（仕入は USD/JPY 混在、為替レートで円換算） |
| UI言語 | 日本語 / 韓国語トグル（`src/lib/i18n.tsx`, `src/lib/translations.ts`） |
| 認証 | 自前の HMAC Cookie セッション（7日）。`@arico.group` ドメインのみ登録可 |

> ⚠️ 過去の CLAUDE.md には「DB は SQLite」と書かれていたが**誤り**。本番・ローカルとも Supabase PostgreSQL。

---

## 🚨 触る前に必ず知っておくこと

1. **ローカル開発も本番DBに直結** — ローカルでスクリプトを流すと本番データが変わる。
   テストデータを作ったら必ず消す。破壊的操作（削除・`db push`）は明示的な依頼があった時だけ。
2. **main push = 即本番デプロイ** — push 前に `npx tsc --noEmit`（できれば `npm run build`）を通す。
3. **秘密情報をコード・git に書かない** — MakeShop / スマレジのキーは **Vercel 環境変数のみ**。
   MakeShop アプリを**アンインストールしないこと**（トークンが失効し再連携が必要になる）。
4. **バージョン更新ルール** — デプロイのたびに `src/lib/version.ts` の `APP_VERSION` と
   `package.json` の `version` を**両方**上げてからコミット・プッシュ。
5. **OrderItem は原価のスナップショット** — 商品マスターの原価を直しても既存受注には伝播しない。
   品目の `costPriceJpy` 更新 + 受注の `totalCostJpy` 再計算まで行うこと。
6. **アプリはログイン必須** — ブラウザでの自動検証ができないため、`npx tsc --noEmit` + デプロイが検証の基本。

---

## 仕入先と原価計算（`src/lib/utils.ts` の `calcCostJpy()`）

`SUPPLIER_LIST = ['ARICO','JVD','MK','FIVICS','SHIBUYA','KOREA','ANGEL','WJ','KOWA','OUTLET','ETC']`

| 仕入先 | 通貨 | `costPrice` の意味 | 円換算 |
|---|---|---|---|
| JVD | USD | B2B価格（Excel価格表） | × レート × 1.1（送料+関税） |
| MK | USD | PDF価格表 | × レート × 1.1 |
| FIVICS | USD | Excel の PREMIUM 列 | × レート × 1.1 |
| KOREA | **USD**（2026-08の新価格表から） | 2026 PRICE BOOK | × レート × 1.1 |
| SHIBUYA | JPY | **希望小売価格(税込)をそのまま** | × 0.62（自社ブランド）/ × 0.65（HOYT等） ※ `/1.1` しない |
| ANGEL | JPY | 税抜 | × 0.70（クィーバー/ベルトネーム/トリートメント/ダビン）/ × 0.60 |

> ⚠️ **`Product.costPrice` は仕入先の通貨のまま**保存する。USD 欄に円の数値を入れると換算で数百万円に爆発する
> （過去に2件発生：XENIA ハンドル、Fairweather）。商品編集フォームは通貨ラベルを動的表示している。

---

## 外部連携

- **MakeShop（自社EC）** — 受注・会員の取込が稼働中。**受信（pull）専用**で、送り状や状態の push は行わない。
  詳細 → `docs/makeshop-integration.md`、`docs/handoff/02-makeshop.md`
- **スマレジ（POS）** — 商品・在庫の読み取り連携が稼働中。店舗在庫の表示に使用。
  詳細 → `docs/handoff/03-smaregi.md`
- **運用者用 cron エンドポイント** `/api/cron/*` — ログイン無しで叩ける。
  トークン = `hex(HMAC-SHA256(AUTH_SECRET, '<name>'))`。Claude が直接実行する際の標準手段。

---

## 主要な画面

`/`（ダッシュボード）`/orders`（受注）`/payments`（入金）`/backorders`（バックオーダー）
`/purchase-orders`（発注）`/receiving`（入荷）`/inventory`（在庫）`/makeshop`（受注取込）
`/customers`（取引先）`/catalog`（自社ECカタログ↔仕入先商品のマッチング）`/products`（仕入先商品）
`/analytics`（収益分析）`/exchange-rates`（為替）`/settings` `/manual`（操作マニュアル）
`/documents/[type]/[id]` — **見積書・請求書・納品書・領収書・発注書**の5帳票

---

## 確定した設計判断（再提案しないこと）

- **カタログ自動マッチングは削除済み**（2026-07-17）。名前類似度では精度が出ず、特に左右(RH/LH)の誤マッチが致命的だった。
  受注時に人が選んだマッチングを学習する方式（`/api/orders` POST）のみ残す。
- **オプションは個別商品のまま + 画面側で仮想的に束ねる**（`src/lib/variants.ts`）。スキーマは変えない。
- **ブランドは `Product.brand` の文字列属性**。Brand エンティティは作らない。
- **分割発送は Shipment モデルで実装済み**（2026-08-06）。回数ごとに発送日・送り状・品目・数量を記録。
- **「配送完了」段階は廃止**（2026-08-11）。全数発送＝即完了（`delivered` + `completedAt`）。
  ただし MakeShop 取込の未入金ガード（未入金なら `shipped` 維持）は債権管理のため残す。

---

## 開発上の落とし穴（繰り返し踏んだもの）

- **Git Bash のヒアドキュメントがバックスラッシュを食う** — `\s` が `s` になる。
  **正規表現を含むスクリプトは必ず Write ツールでファイル作成**すること。
- **`\b` は日本語文字の後で効かない** → `(^|[\s　])…([\s　]|$)` の境界を使う。
- PDF 抽出テキストに **NBSP(0xA0)** が混ざる → `normalize('NFKC')` で統一。
- **PowerShell のファイル書き込みは BOM に注意** → `[IO.File]::WriteAllText($p,$t,(New-Object Text.UTF8Encoding $false))`。
- **React: コンポーネント関数の中にコンポーネントを定義しない**（再描画のたびに再生成され input のフォーカスが飛ぶ）。
- **取引先コードの採番は数値の最大値で行う** — `orderBy code desc` は文字列順（'C999' > 'C1201'）になり重複する。
- **DB一括更新スクリプトは undo ログを適用前に書く**（log-first）。途中でクラッシュしてログを失った事例あり。
- 日付は `toISOString()` だと UTC で朝に前日へずれる → ローカル日付を使う。

---

## Claude への作業依頼のしかた

1. 最初に「`HANDOFF.md` と `docs/handoff/` を読んで把握して」と指示する。
2. 一括データ修正を頼むときは「まずプレビューを見せて」と言う（このプロジェクトの慣習：
   `.mjs` スクリプトを作る → プレビュー実行 → 確認後 `--apply` → undo ログを残す → スクリプトは削除）。
3. デプロイまで頼む場合は「バージョンを上げてコミット・プッシュまで」と伝える。
4. **新しい Claude アカウントには過去の記憶が無い**。作業で分かった重要な事実は
   「`docs/handoff/` に追記して」と頼み、リポジトリに残していくこと。

---

## 参考ドキュメント

| ファイル | 内容 | 言語 |
|---|---|---|
| `HANDOFF.md` | 引き継ぎの入口（環境構築・運用・注意事項） | 日本語 |
| `docs/handoff/` | 業務知識の詳細（システム・MakeShop・スマレジ・データ整備・未解決課題） | 日本語 |
| `docs/ARCHITECTURE.md` | データモデル・業務フロー | 韓国語 |
| `docs/makeshop-integration.md` | MakeShop API 仕様の詳細 | 韓国語 |
| アプリ内 `/manual` | 画面操作マニュアル | 日/韓 |

> 韓国語の資料は Claude に「日本語に要約して」と頼めば読めます。
