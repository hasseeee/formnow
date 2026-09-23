# アーキテクチャ

はじめてコードを読む人向けの地図です。細かい仕様の経緯は [設計書](superpowers/specs/2026-09-07-formnow-design.md) にあります。

## 全体像

Cloudflare Workers の **Worker 1つ**に、画面・API・MCPサーバーがすべて入っています。

```
ブラウザ ──┬─ /            React の画面（静的ファイル）
           ├─ /api/forms/*   回答者向けAPI（認証なし）
           ├─ /api/admin/*   管理API（ADMIN_TOKEN 必須。読み取りだけなら VIEWER_TOKEN も可）
Claude ────┴─ /mcp           MCPサーバー（MCP_TOKEN 必須）
                    │
                    └─ D1（SQLite）… 正のデータ
                          └─ Googleスプレッドシート … 同期先（任意）
```

## ディレクトリ

```
src/
  shared/types.ts     APIの形を決める唯一の契約。フロントもバックもここを参照する
  worker/             サーバー側（Hono）
    index.ts            ルーティングの入口
    routes/             HTTPの受け口。入力検証（zod）と認証はここ
      public.ts           回答者向け
      admin.ts            管理画面向け
      mcp.ts              MCPの入口
    mcp/tools.ts        Claudeから呼べるツールの定義
    services.ts         routes と mcp の両方から使う共通処理（集計など）
    db.ts               D1へのSQL。DBの行(snake_case) → 型(camelCase) の変換もここ
    logic/              ★計算の本体。DBにもHTTPにも依存しない純関数
      scoring.ts          回答1件の点数（値 × 重み）
      aggregate.ts        チーム別の平均・順位、回答者ごとの傾向、標準化平均
      formula.ts          計算式のパーサー（eval は使わない）
      csv.ts / security.ts
    sheets.ts           Googleスプレッドシート連携
  client/             ブラウザ側（React）
    api.ts              fetch のラッパー。サーバーとの通信は全部ここを通る
    pages/public/       回答画面。FormFlow.tsx が「名前選択→チーム順に評価→完了」の流れ
    pages/admin/        管理画面。FormEditPage.tsx がGoogleフォーム風のエディタ
    components/         共通部品（Markdown表示、⋯メニュー、トーストなど）
migrations/           DBスキーマ。連番のSQLファイル
tests/                単体テスト（logic/ の純関数）と、integration/ の結合テスト（APIを実SQLの上で動かす）
```

## データの形

```
events（イベント）
 ├─ teams（評価されるチーム）
 ├─ respondents（回答者。役割=審査員/メンバー、メンバーは所属チームあり）
 ├─ forms（フォーム。種別=審査員用/相互評価用）
 │   ├─ questions（質問。型・配点上限・重み）
 │   └─ responses（「誰が・どのチームを」評価したか。1組につき1件）
 │       └─ answers（質問ごとの回答値）
 └─ formulas（複数フォームをまたぐ計算式）
```

親を消すと子も消えます（`ON DELETE CASCADE`）。**チームや回答者を消すと、その回答も消える**ので注意してください。

## 押さえておきたい設計判断

- **計算は `logic/` の純関数に集める。** 順位に直結する処理をテストしやすくするためです。routes や db に計算を書かないでください。
- **回答者に内部情報を渡さない。** 回答者向けAPIは `PublicQuestion` 型で、重みと選択肢の配点を落として返します。
- **回答は「回答者 × チーム」で1件。** 同じ組み合わせで再送信すると上書きになります。
- **回答0件は0点ではない。** 回答がないフォームの平均を計算式で参照したチームは、結果が「なし」になります。
- **管理画面の一括保存は「一覧にないものは削除」、MCPは「削除しない」。** Claude が一覧を渡し間違えても回答が消えないようにするためです。
- **プレビューと本番の回答画面は同じ部品。** `FormFlow` に「保存の仕方」だけ差し替えて渡しています。片方だけ直す、ということが起きません。
- **スプレッドシートには文字列として書く。** 回答に `=IMPORTXML(...)` のような数式を書かれても実行されないようにしています。

## よくある変更の入口

| やりたいこと | 触る場所 |
|---|---|
| 質問の種類を増やす | `shared/types.ts` → `logic/scoring.ts`（点数化）→ `routes/public.ts`（入力検証）→ `client/pages/public/QuestionField.tsx`（入力UI）→ `client/pages/admin/QuestionEditor.tsx`（編集UI） |
| 集計方法を変える | `logic/aggregate.ts` とそのテスト |
| Claudeからできる操作を増やす | `mcp/tools.ts`（中身は `services.ts` / `db.ts` を再利用） |
| テーブルを変える | `migrations/` に新しい連番ファイル → `db.ts` → `shared/types.ts` |
