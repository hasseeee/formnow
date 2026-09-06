# FormNow 設計書

日付: 2026-09-07
ステータス: 承認済み（案A採用）

## 目的

サークルイベント（発表会・LT大会など）向けのGoogleフォーム代替。審査員フォームとメンバー相互評価フォームの2系統を運用し、両方をまたいだ採点集計を行う。

## 要件

- 審査員フォーム＋相互評価フォームの2種類を管理・集計できる
- 回答者はURL共有＋名前選択のみ（ログインなし）
- 評価対象チームを順番に1チームずつ評価できる（相互評価では自チームを自動スキップ）
- 質問文・説明文はMarkdown対応（自由記述回答も結果画面でMarkdown表示）
- 計算: 質問ごとの重み付け配点 / チーム別の平均・順位 / イベント単位の自由計算式
- Googleスプレッドシートへの自動追記＋一括同期、CSVエクスポート
- MCP対応: Claudeからフォーム作成・管理、集計・分析

## アーキテクチャ

1つのCloudflare Workerに全機能を同居させる。

- **回答UI / 管理UI**: Vite + React SPA（静的アセット配信、SPAフォールバック）
- **API**: Hono（`/api/*`）
- **DB**: D1（SQLite）。D1が正、シートは同期先
- **MCP**: `/mcp`（Streamable HTTP、@hono/mcp + @modelcontextprotocol/sdk、ステートレス）。Bearerトークン（`MCP_TOKEN`）で保護
- **Sheets連携**: サービスアカウント（`GOOGLE_SERVICE_ACCOUNT_JSON` シークレット）。WebCryptoでJWT署名→アクセストークン取得→Sheets REST API
- **管理画面認証**: `ADMIN_TOKEN` シークレット（Bearer / 管理画面はトークン入力）

## データモデル

- **events** — イベント。id, name, created_at
- **teams** — id, event_id, name, sort_order
- **respondents** — id, event_id, name, role('judge'|'member'), team_id(null可。相互評価の自チーム除外に使用), sort_order
- **forms** — id, event_id, slug(URL用一意), title, description_md, kind('judge'|'peer'), status('draft'|'open'|'closed'), sheet_id(null可), created_at
  - kind='judge' → role='judge' の回答者が対象。kind='peer' → role='member' が対象で自チームをスキップ
- **questions** — id, form_id, sort_order, type('rating'|'number'|'choice'|'checkbox'|'text'|'textarea'), label_md, options_json, max_score, weight(実数,デフォルト1), required
  - 採点対象は rating / number。choice は options に配点を持たせられる（value→score）
- **responses** — id, form_id, respondent_id, team_id, submitted_at。UNIQUE(form_id, respondent_id, team_id)、再送信は上書き
- **answers** — response_id, question_id, value_json
- **formulas** — id, event_id, name, expression

## 回答フロー

1. `/f/:slug` を開き名前を選択（対象roleの回答者のみ表示）
2. チームをsort_order順に1チームずつ表示（進捗「3 / 5」）。peerフォームは自チームをスキップ
3. チームごとに送信（サーバーにupsert）。戻って修正可。リロード後は保存済み回答から再開
4. 全チーム完了画面

## 計算・集計

1. **回答1件のスコア** = Σ(数値化した回答値 × 質問weight)。数値化: rating/numberは値そのもの、choiceはoptionsの配点、checkboxは選択したoptionsの配点合計、text系は対象外。choice/checkboxの値は送信時にoptionsのラベルと照合して検証（未知ラベルは400）。集計時にラベル未一致となった過去回答は0でなくnull（採点除外）扱い
2. **チーム別集計**（フォーム単位）: avg / sum / count、質問別平均、順位
3. **自由計算式**（イベント単位）: 変数 `<form_slug>_avg` `<form_slug>_sum` `<form_slug>_count`、四則演算・括弧・数値リテラル。evalは使わず自前トークナイザ＋再帰下降パーサー（変数名は既知変数の最長一致で切り出し、ハイフン付きslugと減算を両立）。ゼロ除算・構文エラーは式のエラーとして表示。回答0件のフォームのavgを参照したチームは結果null（0点扱いしない）
4. **ランキングの並び順**: FormSummary.teams / FormulaResults.ranking はrank昇順（rank=nullは末尾）でサーバーから返す

## Sheets連携

- 管理者がシートをサービスアカウントのメールに共有し、フォームにsheet_idを設定
- 回答送信時に1行自動追記（失敗しても回答受付はブロックしない）
- 一括同期: フォームタブを全消し→全回答書き直し＋「集計」タブにチーム別集計・計算式結果を出力
- CSVエクスポート（Sheets未設定でも利用可）

## 削除セマンティクス

- 管理API/管理画面の一括保存（teams/respondents/questions/formulas）は「リストにないidは削除」方式。削除はCASCADEで回答にも及ぶため、管理画面は既存行の削除時に確認ダイアログを表示する
- MCPのset_系ツールは「削除しないマージ」方式（id→名前の順で既存行に解決、リストにない既存行は保持）。Claudeの操作ミスによるデータ消失を防ぐ

## MCPツール

- イベント: create_event / list_events / set_teams / set_respondents
- フォーム: create_form / update_form / list_forms / get_form / set_questions / open_form / close_form
- 集計: get_responses / get_team_summary / set_formula / get_formula_results
- 連携: sync_to_sheets

## API（概要）

公開:
- GET /api/forms/:slug — フォーム定義＋チーム＋対象回答者名簿
- GET /api/forms/:slug/responses?respondentId= — 自分の保存済み回答
- POST /api/forms/:slug/responses — {respondentId, teamId, answers} upsert

管理（Bearer ADMIN_TOKEN, /api/admin/*）:
- events/teams/respondents/forms/questions CRUD
- GET forms/:id/summary — チーム別集計
- GET events/:id/formula-results
- POST forms/:id/sync-sheets
- GET forms/:id/export.csv

## エラー処理

- Sheets API失敗は記録のみ（同期で回復）
- 二重送信はupsert
- closedフォームへの送信は409

## テスト

- Vitest: 計算式パーサー、スコア計算、集計ロジック、CSV生成の単体テスト
- APIはHono経由の結合テスト（可能な範囲で）
- 最終確認: `npm run build` / `tsc --noEmit` / ローカルで`vite dev`起動確認
