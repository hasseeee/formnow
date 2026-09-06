# FormNow

サークルイベント（発表会・LT大会など）向けの評価フォームアプリ。Googleフォームの代替として、以下ができます。

- **審査員フォーム＋メンバー相互評価フォーム**の2系統を管理
- 評価対象チームを**順番に1チームずつ評価**（相互評価では自チームを自動スキップ）
- 質問文・説明文の**Markdown対応**
- **重み付け採点**、チーム別の平均・順位、`審査員_avg * 0.7 + 相互評価_avg * 0.3` のような**自由計算式**での横断集計
- **Googleスプレッドシート連携**（回答の自動追記＋一括同期）と CSVエクスポート
- **MCP対応** — Claudeからフォーム作成・管理・集計・分析

スタック: Cloudflare Workers + Hono + D1 + Vite/React。1つのWorkerで回答UI・管理画面・API・MCPサーバーすべてを配信します。

## 開発

```bash
npm install
npm run db:migrate:local   # ローカルD1にマイグレーション適用
npm run dev                # http://localhost:5173
```

ローカルでは `.dev.vars` にシークレットを置きます:

```
ADMIN_TOKEN=dev-admin-token
MCP_TOKEN=dev-mcp-token
# GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}  # Sheets連携する場合のみ
```

テスト・型チェック:

```bash
npm test
npm run check
```

## デプロイ

```bash
# 1. D1データベース作成（初回のみ）。出力された database_id を wrangler.jsonc に反映
npx wrangler d1 create formnow

# 2. マイグレーション適用
npm run db:migrate:remote

# 3. シークレット設定（初回のみ）
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put MCP_TOKEN
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON   # Sheets連携する場合のみ

# 4. デプロイ
npm run deploy
```

## 使い方の流れ

1. `/admin` を開き、`ADMIN_TOKEN` でログイン
2. イベントを作成 → チームと回答者（審査員/メンバー、メンバーは所属チームも）を登録
3. フォームを作成（審査員用 or 相互評価用）→ 質問を設定（配点・重み付き）→ 公開
4. 回答URL `/f/<slug>` をサークルメンバーに共有
5. 結果画面でランキング・個別回答を確認。イベントの「計算式」で複数フォームを合算した最終順位を定義

## Googleスプレッドシート連携の初期設定（初回のみ・約15分）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（既存でも可）
2. 「APIとサービス」→「ライブラリ」で **Google Sheets API** を有効化
3. 「IAMと管理」→「サービスアカウント」→ サービスアカウントを作成（権限付与は不要）
4. 作成したサービスアカウントの「キー」タブ → 「鍵を追加」→ JSON をダウンロード
5. JSONの中身を1行で `GOOGLE_SERVICE_ACCOUNT_JSON` シークレットに設定
6. 連携したいスプレッドシートを、サービスアカウントのメールアドレス（`xxx@yyy.iam.gserviceaccount.com`）に**編集者として共有**
7. スプレッドシートのURLの `/d/` と `/edit` の間のIDを、管理画面のフォーム設定「シートID」に貼り付け

以後、回答が送信されるたびにシートへ1行追記され、管理画面の「一括同期」でいつでも全回答＋集計タブを書き直せます。

## MCP（Claude連携）

デプロイ後、Claude Code に登録:

```bash
claude mcp add --transport http formnow https://<your-worker>.workers.dev/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

使用例:

> 「春の発表会のLT審査フォームを作って。項目は技術力（10点・重み2）、デザイン（10点）、発表（10点）。チームはA班/B班/C班」

> 「審査員と相互評価を7:3で合算した最終ランキングを出して」

主なツール: `create_event` / `set_teams` / `set_respondents` / `create_form` / `set_questions` / `open_form` / `get_team_summary` / `set_formula` / `get_formula_results` / `sync_to_sheets`
