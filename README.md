# FormNow

[![CI](https://github.com/hasseeee/formnow/actions/workflows/ci.yml/badge.svg)](https://github.com/hasseeee/formnow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

サークルの発表会・LT大会のための評価フォームです。Googleフォームでは面倒だった「チームを順番に採点して、審査員と相互評価を合算して順位を出す」を、ひとつのツールで完結させます。

## できること

- **チームを順番に評価** — 1チームずつ同じ質問で採点。途中で閉じても続きから再開できます
- **審査員フォームと相互評価フォーム** — 相互評価では自分のチームが自動で飛ばされます
- **重み付け採点と横断集計** — 質問ごとの重み、チーム別の平均・順位。`judge_avg * 0.7 + peer_avg * 0.3` のような計算式で最終順位を定義できます
- **Googleフォーム風のエディタ** — 1クリックで作成、自動保存、プレビュー、複製
- **Markdown対応** — 質問文・説明文・自由記述の講評
- **Googleスプレッドシート連携とCSV** — 回答の自動追記と一括同期
- **MCP対応** — Claude に「LT大会の審査フォーム作って」と頼めば作れます

回答者はURLを開いて名前を選ぶだけ。ログインは不要です。重みや配点は回答者には見えません。

## 技術スタック

Cloudflare Workers + [Hono](https://hono.dev/) + D1（SQLite）+ React（Vite）。Worker 1つに画面・API・MCPサーバーがすべて入っています。TypeScript、テストは Vitest。

## 動かしてみる

Node.js 22 以上が必要です。

```bash
git clone git@github.com:hasseeee/formnow.git
cd formnow
npm ci
printf 'ADMIN_TOKEN=dev-admin-token\nMCP_TOKEN=dev-mcp-token\n' > .dev.vars
npm run db:migrate:local
npm run dev
```

http://localhost:5173/admin を開き、`dev-admin-token` でログインします。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run check` | 型チェック |
| `npm test` | テスト |
| `npm run build` | 本番ビルド |

## 使い方

1. 管理画面でイベントを作り、「チームと回答者」を登録する
2. 「＋ 審査員フォーム」か「＋ 相互評価フォーム」を押す。エディタが開くので質問を足す（自動保存）
3. 「プレビュー」で回答画面を確認し、「公開中」に切り替えて「共有」でURLを配る
4. エディタの「回答」タブで順位と個別回答を見る。イベントページの「横断集計と計算式」で最終順位を定義する

## Claude から操作する（MCP）

```bash
claude mcp add --transport http formnow https://<あなたのWorker>.workers.dev/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

> 「春の発表会の審査フォームを作って。項目は技術力（10点・重み2）、デザイン（10点）、発表（10点）。チームはA班/B班/C班」
>
> 「審査員と相互評価を7:3で合算した最終ランキングを出して」

Claude 経由の操作では、既存のチームや質問が消えることはありません（追加と更新のみ）。

## ドキュメント

| 読む人 | ドキュメント |
|---|---|
| コードを書きたい | [CONTRIBUTING.md](CONTRIBUTING.md) — セットアップ、PRの流れ、コードの約束ごと |
| コードの全体像を知りたい | [docs/architecture.md](docs/architecture.md) |
| 本番を運用する | [docs/operations.md](docs/operations.md) — デプロイ、バックアップ、スプレッドシート連携の設定、当日のチェックリスト |
| 設計の経緯を知りたい | [設計書](docs/superpowers/specs/2026-09-07-formnow-design.md) |
| 脆弱性を見つけた | [SECURITY.md](SECURITY.md) |

## コントリビューション

バグ報告も改善案もPRも歓迎です。`main` へは直接pushせず、Pull Request を通します。詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) へ。

## ライセンス

[MIT](LICENSE)
