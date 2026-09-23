# コントリビューションガイド

FormNow はサークルのメンバーみんなで育てるツールです。バグ報告、改善案、ドキュメントの修正、どれも歓迎します。
はじめての人は [`good first issue`](https://github.com/hasseeee/formnow/labels/good%20first%20issue) のラベルが付いたIssueからどうぞ。

## 開発環境のセットアップ

Node.js 22 以上が必要です（`.nvmrc` あり）。

```bash
git clone git@github.com:hasseeee/formnow.git
cd formnow
npm ci
```

プロジェクト直下に `.dev.vars` を作ります（ローカル専用の仮の値。コミットされません）。

```
ADMIN_TOKEN=dev-admin-token
MCP_TOKEN=dev-mcp-token
VIEWER_TOKEN=dev-viewer-token
```

```bash
npm run db:migrate:local   # ローカルのD1（SQLite）にテーブルを作る
npm run dev                # http://localhost:5173
```

`http://localhost:5173/admin` を開き、`dev-admin-token` でログインできれば準備完了です。
`dev-viewer-token` で入ると閲覧専用の画面を確認できます。

> **`db:migrate:local` が `_cf_ALARM has 3 columns` というエラーで落ちるとき**
> `wrangler` と `@cloudflare/vite-plugin` の版がずれています。`git pull` のあと `npm ci` をやり直してください。この2つは必ずセットで更新します。
コードの全体像は [docs/architecture.md](docs/architecture.md) を読んでください。

## 変更の流れ

`main` には直接pushできません。必ずPull Requestを通します。

1. **Issueを確認・作成する。** 大きめの変更は、書き始める前にIssueで方針を相談してください。手戻りが減ります。
2. **ブランチを切る。** 名前は `種類/短い説明` にします。
   - `feat/survey-form`（機能追加）、`fix/rating-slider`（バグ修正）、`docs/readme`、`refactor/…`、`test/…`、`chore/…`
3. **小さくコミットする。** 途中のコミットメッセージは自由です（マージ時に1つにまとめます）。
4. **早めにDraft PRを出す。** 完成前でも構いません。方向性のズレに早く気づけます。
5. **CIが通ったら「Ready for review」にする。** レビュー1件の承認とCI通過でマージできます。
6. **Squash mergeでマージする。** PRのタイトルがそのまま `main` のコミットメッセージになります。

> **PRは積まない。** 別のPRの上にPRを作る（PRの向き先を `main` 以外にする）と、土台のPRがSquashマージされた時点で上のPRがコンフリクトし、載せ直しが必要になります。依存する変更は、土台がマージされてから次のPRを出してください。

### PRのタイトル

[Conventional Commits](https://www.conventionalcommits.org/ja/) の形式で、日本語で書きます。

```
feat: チームに紐づかないアンケートフォームを追加
fix: スライダー未操作でも入力済みに見える問題を修正
docs: デプロイ手順にバックアップを追記
```

種類は `feat` / `fix` / `docs` / `refactor` / `test` / `chore` のどれかです。

### PRの大きさ

1つのPRは1つの目的に絞ってください。目安は差分400行以内です。リファクタリングと機能追加は別のPRに分けます。
レビューする側の負担が下がり、結果的に早くマージされます。

## マージの前に確認すること

```bash
npm run format  # フォーマット（Prettier）
npm run check   # 型チェック
npm test        # テスト
npm run build   # 本番ビルド
```

この4つはCIでも自動で走ります（フォーマットはCIでは `npm run format:check` で、整形されていないファイルがあると失敗します）。加えて、**`npm run dev` で実際に画面を触って確認**してください。型とテストが通っても画面が壊れていることはあります。

エディタで保存時に自動整形させておくと楽です。VS Code なら拡張 [Prettier - Code formatter](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)（`.vscode/extensions.json` で推奨済み）を入れて、設定で `editor.formatOnSave` を有効にしてください。

UIを変えたPRにはスクリーンショットを貼ってください。

## テストの書き方

テストは2種類あります。どちらも `npm test` で走ります。

- **単体テスト**（`tests/*.test.ts`）: `src/worker/logic/` の純関数が対象。計算を変えたら必ずここを足します。
- **結合テスト**（`tests/integration/`）: APIを実際のSQLの上で動かします。HTTPサーバーもCloudflareも不要で、Node組み込みのSQLite（インメモリ）を使うので一瞬で終わります。

結合テストは `createTestClient()` と `seed()` を使うと数行で書けます。

```ts
const client = createTestClient();
const f = await seed(client);            // チーム3つ・審査員2人・メンバー2人・フォーム2つ
const res = await submitJudge(client, f, f.judges[0].id, f.teams.a.id, 8, 7);
expect(res.status).toBe(200);
```

APIの入力検証、認証、削除を伴う処理を変えたときは、結合テストを足してください。
実行時に出る `ExperimentalWarning: SQLite is an experimental feature` は無視して構いません。

## コードの約束ごと

- **計算ロジックは純関数にして `src/worker/logic/` に置き、テストを書く。** 採点・集計・計算式・CSVなど、結果が順位に影響する処理は特に重要です。DBやHTTPに依存させないでください。
- **APIの形は `src/shared/types.ts` が唯一の契約。** フロントとバックの両方がここを参照します。形を変えるときはここから直します。
- **回答者向けAPIに内部情報を出さない。** 質問の重みや選択肢の配点は `PublicQuestion` 型で除外しています。
- **DBスキーマの変更は新しいマイグレーションファイルで。** `migrations/0002_….sql` のように連番で追加します。適用済みのファイルは絶対に編集しません。
- **回答データを消す変更は慎重に。** チーム・回答者・質問を削除すると、紐づく回答もDBの制約で一緒に消えます。削除を伴う処理を足すときは、PRにその旨を明記してください。
- **UIの文言は日本語、専門用語は避ける。** 使うのはプログラマーだけではありません（例:「スラッグ」ではなく「URL名」）。
- 周りのコードの書き方（命名、コメントの量）に合わせてください。

## やってはいけないこと

- トークン、サービスアカウントのJSON、`.dev.vars` をコミットする
- 本番のデータベースを手元から直接書き換える
- 回答者の実名が写ったスクリーンショットをIssueやPRに貼る

## AIツールの利用について

Claude Code などのAIツールを使って構いません。ただし、PRを出すのはあなたです。
生成されたコードは自分で読んで理解し、動かして確認してから出してください。「AIがそう書いたので」はレビューで通りません。

## レビューする人へ

- 指摘は人ではなくコードに向ける。理由を添える
- 好みの問題と、直すべき問題を区別して書く（例:「nit:」「must:」を頭に付ける）
- 良いところも書く
- 1営業日以内に最初の反応を返すのが目標

## デプロイ

マージしても本番には自動で反映されません。デプロイはメンテナが手動で行います。手順は [docs/operations.md](docs/operations.md) にあります。
