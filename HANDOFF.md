# ARICO Hub 引き継ぎドキュメント / HANDOFF

> 新担当者向けの引き継ぎ資料。このファイルを最初に読んでください。
> Claude（AIアシスタント）に作業を依頼する場合も、まず「HANDOFF.md を読んでプロジェクトを把握して」と指示してください。
> 作成日: 2026-07-14（v1.30.8 時点）

---

## 1. プロジェクト概要

**ARICO Distribution Hub** — アーチェリー用品の卸・小売を統合管理する社内Webアプリ。

- 仕入先8社（JVD・MK・FIVICS・SIBUYA・KOREA・ANGEL・ARICO・KOWA）の原価・受注・発注・入金を一元管理
- 自社EC「アリコショップ」（MakeShop, arico-archery.com）と API 連携済み（受注・会員の自動取込）
- 基準通貨は **JPY**。仕入は USD/JPY 混在、為替レートで円換算
- UI は 日本語/韓国語 切替（Alt+L または画面上のトグル）

| 項目 | 内容 |
|---|---|
| 本番URL | https://arico-hub.vercel.app |
| コード | https://github.com/arico-archery/arico-hub （main への push で自動デプロイ） |
| 技術 | Next.js 16 (App Router) / React 19 / Prisma 5 / TailwindCSS |
| DB | Supabase PostgreSQL（東京リージョン） |
| ホスティング | Vercel（無料枠、関数タイムアウト60秒） |
| メール送信 | Resend（会員登録の認証メール用） |

---

## 2. システム構成図

```
[MakeShop アリコショップ]──GraphQL API──▶ [arico-hub (Vercel)] ◀──▶ [Supabase PostgreSQL]
   受注・会員データ取込                        │
                                              ▼
[GitHub arico-archery/arico-hub] ──main push──▶ Vercel 自動デプロイ
```

- **ローカル開発環境も本番DBに直結**しています（後述の注意事項参照）
- MakeShop API の認証キーは **Vercel の環境変数のみ**に保存（コード・gitには一切含めない）

---

## 3. 環境構築手順（新PC）

前提: Node.js 20以上 / Git がインストール済み。GitHub の Collaborator 招待を受諾済み。

```bash
# 1. クローン
git clone https://github.com/arico-archery/arico-hub.git
cd arico-hub

# 2. 環境変数ファイル作成
#    .env.example をコピーして .env を作り、引き継いだ値を記入
#    必要なのは3つ: DATABASE_URL / DIRECT_URL / AUTH_SECRET
cp .env.example .env

# 3. 依存関係インストール（postinstall で prisma generate も実行される）
npm install

# 4. 開発サーバー起動
npm run dev
# → http://localhost:3000 が開けば成功。ログイン画面が出ます。
```

### ログインアカウント

- 会員登録は `@arico.group` ドメインのメールのみ許可（メール認証あり）
- スーパー管理者はコード内定数で管理: `src/lib/session.ts` の `SUPER_ADMINS`
- ユーザー管理画面: `/admin/users`

### よく使う npm スクリプト

| コマンド | 用途 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（デプロイ前の確認に） |
| `npm run db:studio` | Prisma Studio（DBをGUIで閲覧・編集 ⚠️本番DB直結） |
| `npm run db:push` | スキーマ変更をDBに反映（⚠️慎重に） |

---

## 4. 日常運用マニュアル

アプリ内の `/manual` ページにも操作説明があります。主要業務の流れ:

### 4-1. 受注の流れ（全体像）

```
顧客注文 → 発注書発行 → 在庫確認・メーカー請求書 → 仕入支払 → 入荷 → 顧客発送 → 顧客入金
```

### 4-2. MakeShop 受注取込

- サイドバー「MakeShop 受信」→ プレビュー確認 → 取込実行（直近30日分）
- 取込済み注文は `externalOrderNo` で重複防止されるので、何度実行しても二重登録されない
- 未マッチ商品は ETC 商品として自動作成 → 注文管理で修正
- 大量取込でタイムアウトする場合は期間を分割（開発者向け: `/api/cron/import-orders?from=YYYYMMDD&to=YYYYMMDD&token=`、トークンは AUTH_SECRET から HMAC 生成）

### 4-3. MakeShop 会員同期

- 取引先管理 →「MakeShop会員」ボタン（全件更新）/「新規のみ」ボタン(高速)
- 全件は約2,600名 × ページ分割で数分かかる。処理中はページを閉じない
- MakeShop側に名前未登録の会員は会員IDが名前欄に入る（自動補完不可、手動修正のみ）

### 4-4. バックオーダー → 発注

- バックオーダー画面で未発注品目を仕入先ごとに確認 → 発注書(PO)自動生成
- 発注書詳細で「在庫確認」（メーカー回答の数量入力、不足分は自動的にバックオーダーへ戻る）→「仕入支払」→「入荷処理」

### 4-5. 請求書・見積書・発注書の発行

- 注文詳細から発行。日本の標準的な請求書様式（税込・内消費税・件名・振込先・代表者印欄）
- 発行元情報・振込先口座は「設定」画面で変更可能

### 4-6. 為替レート

- 「為替設定」画面で手動更新、または Naver 金融からの自動取得ボタン
- USD 仕入先の原価 = `costPrice × レート × 1.1`（送料+関税10%込み）

---

## 5. アカウント・秘密情報の場所

| 秘密情報 | 保管場所 | 備考 |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | ローカル `.env` + Vercel 環境変数 | Supabase 接続文字列 |
| `AUTH_SECRET` | ローカル `.env` + Vercel 環境変数 | セッション署名 + cron トークン生成 |
| `MAKESHOP_GQL_ENDPOINT` / `MAKESHOP_API_TOKEN` / `MAKESHOP_API_KEY` | **Vercel 環境変数のみ** | ⚠️コード・git・ローカルに置かない |
| `RESEND_API_KEY` / `MAIL_FROM` | Vercel 環境変数 | 認証メール送信用 |

Vercel 環境変数の確認: Vercel ダッシュボード → プロジェクト → Settings → Environment Variables

---

## 6. ⚠️ 重要な注意事項

1. **ローカル開発も本番DBに直結** — ローカルでデータを消すと本番データが消えます。テストデータを作ったら必ず削除。破壊的なDB操作（削除・db push）は慎重に。
2. **MakeShop アプリを絶対にアンインストールしない** — アンインストールすると API トークンが無効化され、再連携が必要になります。
3. **MakeShop の秘密キーをコードや git に書かない** — Vercel 環境変数のみ。
4. **main ブランチへの push = 即本番デプロイ** — push 前に `npm run build` が通ることを確認。
5. **バージョン管理ルール** — デプロイのたびに `src/lib/version.ts` の `APP_VERSION` と `package.json` の `version` を両方上げる（現在 v1.30.8）。
6. **Vercel 関数は60秒でタイムアウト** — 大量データ処理はページ分割・期間分割で実装済み。新機能でも同じ配慮が必要。

---

## 7. 未解決課題・今後の予定

| 課題 | 状況 |
|---|---|
| MakeShop 商品照会権限 | **承認待ち**。searchProduct が FORBIDDEN のため商品同期（`/api/makeshop/sync-products`）が未稼働。MakeShop に商品スコープを申請する必要あり |
| paymentStatusCode の正確なマッピング | 暫定: `0002=入金済み、他=未入金`。観測値 0000/0001/0002/1002。実注文と管理画面の照合で確定させる |
| 注文オプションが内部コードのまま | basket の `variationCustomCode`（13〜14桁）を備考に保存中。スマレジ連携後に「コード→色/サイズ」へ変換予定。**削除しないこと**（決定済み） |
| スマレジ連携 | 計画段階。商品・オプション・在庫のマスターをスマレジに置く構想。`SMAREGI_CONTRACT_ID/CLIENT_ID/CLIENT_SECRET` が必要 |
| 受注の自動取込スケジューラ | 手動ボタンのみ。Vercel Cron での定期実行は未設定 |
| 名前が会員ID表示の取引先 19件 | MakeShop 側に名前情報が無いもの。手動入力のみ可 |

---

## 8. 参考ドキュメント

| ファイル | 内容 | 言語 |
|---|---|---|
| `HANDOFF.md` | 本ファイル（引き継ぎ） | 日本語 |
| `docs/ARCHITECTURE.md` | データモデル・業務フロー・核心モジュール | 韓国語 |
| `docs/makeshop-integration.md` | MakeShop API 連携の詳細仕様 | 韓国語 |
| `CLAUDE.md` | Claude 用の開発履歴・決定事項（自動読込される） | 韓国語 |
| アプリ内 `/manual` | 画面操作マニュアル | 日/韓 |

> 韓国語ドキュメントは Claude に「日本語に要約して」と頼めばすぐ読めます。

---

## 9. Claude（AI）との作業の進め方

このプロジェクトは Claude Code と一緒に開発されてきました。新しい Claude アカウントでも:

1. プロジェクトフォルダで Claude を起動 → `CLAUDE.md` は自動で読み込まれる
2. 最初の指示: 「**HANDOFF.md と docs/ARCHITECTURE.md を読んでプロジェクトを把握して**」
3. 開発依頼の例:
   - 「◯◯のバグを直して、バージョンを上げてコミット・プッシュまでして」
   - 「MakeShop の受注取込が失敗する。原因を調べて」
4. Claude への依頼時の約束事:
   - デプロイ時はバージョン番号を上げる（§6-5）
   - DB の破壊的操作は明示的に依頼された時のみ
   - テストデータは作業後に必ず削除
