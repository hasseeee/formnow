# 閲覧専用トークン（VIEWER_TOKEN）仕様書

日付: 2026-09-23
ステータス: 承認済み（承認日 2026-09-23）
ブランチ: `feat/viewer-token`
出典: [Googleフォーム UI 調査メモ](../../research/2026-09-23-google-forms-ux-research.md) の「5. formnow への具体的提案」10

## 目的

管理画面に、**回答と集計を見るだけ**の閲覧専用ログインを追加する。当日の司会・集計係に配れる読み取り専用トークンがあれば、運営を複数人で回せる。そのとき `ADMIN_TOKEN`（削除も公開切替もできる）を渡さなくて済む。

## 背景

- Googleフォームへの不満として「回答を見るだけの権限がなく、編集権限を渡すしかない」がよく挙がる。
- formnow の管理 API は `ADMIN_TOKEN` 1 本で守られていて（`src/worker/routes/admin.ts` 17〜24 行）、同じ不満がそのまま当てはまる。
- 当日は司会が順位を読み上げ、集計係が CSV を取る。この 2 人に削除権限は要らない。

## 範囲外

- 人ごとのアカウント、トークンの発行・失効を画面から行うこと（シークレット 1 本の追加にとどめる）
- フォーム単位・イベント単位の閲覧権限（VIEWER_TOKEN は全イベントを閲覧できる）
- MCP の権限分割。`/mcp` は今までどおり `MCP_TOKEN` だけで認証し、VIEWER_TOKEN は受け付けない。MCP のコード（`routes/mcp.ts`、`mcp/tools.ts`）は変えない
- 回答者向け API（`/api/forms/*`）は変えない
- 閲覧専用のとき、質問（重み・配点を含む）を読み取り専用で見られるエディタ表示。今回は「回答」タブだけを出す（下記）
- 閲覧専用から重みや配点を隠すこと。`GET /forms/:id` のレスポンスには重みが入るが、閲覧者は運営側の人なので隠さない

## 認証の仕様

### シークレット

| 名前 | 必須 | 意味 |
|---|---|---|
| `ADMIN_TOKEN` | 必須 | 管理 API のすべての操作ができる（今までどおり） |
| `VIEWER_TOKEN` | **任意** | 管理 API の読み取りだけができる。未設定または空文字なら閲覧専用ログインは無効（401） |

`Env`（`src/worker/env.ts`）に `VIEWER_TOKEN?: string` を足す。比較には既存の `timingSafeEqual` を使う。この関数は第 2 引数が未設定・空文字なら必ず `false` を返すので、「未設定なら無効」は追加の分岐なしで成り立つ。

承認時の補足:

- `timingSafeEqual(token, c.env.VIEWER_TOKEN)` の第 2 引数が `undefined` でも型エラーにならず `false` を返すことを `src/worker/logic/security.ts` で確認する。型が `string` だけなら `string | undefined` に広げる（挙動は変えない）
- 手動確認のため、未追跡の `.dev.vars` に `VIEWER_TOKEN=dev-viewer-token` を足しておく

### 役割の決め方（ミドルウェア 1 か所）

`adminRoutes.use('*', …)`（`routes/admin.ts` 17〜24 行）を次のように変える。

1. `Authorization: Bearer <token>` を取り出す（今までと同じ）
2. `isAdmin = timingSafeEqual(token, ADMIN_TOKEN)`、`isViewer = timingSafeEqual(token, VIEWER_TOKEN)`。短絡評価で片方を省かず、**両方とも必ず計算する**
3. どちらも偽なら **401** `{ error: 'unauthorized' }`（今までと同じ）
4. `role = isViewer ? 'viewer' : 'admin'`（**両方に一致したら viewer**。後述の同値事故）
5. `role === 'viewer'` で、メソッドが `GET` / `HEAD` 以外なら **403** `{ error: '閲覧専用のトークンでは変更できません' }`
6. `c.set('role', role)` して `next()`

判定はメソッドだけで決まる。各ハンドラの本体は変更しない。管理 API の書き込みはすべて POST / PUT / PATCH / DELETE で、読み取りはすべて GET なので、この規則で取りこぼしは出ない（下表）。今後ルートを足す人向けに、ミドルウェアのコメントに「副作用のある操作を GET で作らないこと」と書く。

Hono の型は `new Hono<{ Bindings: Env; Variables: { role: AdminRole } }>()` にする（13 行目）。

### 判定表（メソッド × 役割）

| トークン | GET / HEAD | POST / PUT / PATCH / DELETE / その他 |
|---|---|---|
| なし・誤り | 401 | 401 |
| ADMIN_TOKEN | 通す | 通す |
| VIEWER_TOKEN（設定あり） | 通す | **403** |
| VIEWER_TOKEN と同じ文字列だが VIEWER_TOKEN が未設定 | 401 | 401 |
| ADMIN_TOKEN = VIEWER_TOKEN の同値事故 | 通す（role は viewer） | **403** |

### ルート別の結果（現行ルートすべて）

| ルート | メソッド | admin | viewer | 補足 |
|---|---|---|---|---|
| `/me`（新規） | GET | 200 `{role:'admin'}` | 200 `{role:'viewer'}` | |
| `/events` | GET | ○ | ○ | |
| `/events` | POST | ○ | 403 | イベント作成 |
| `/events/:id` | GET | ○ | ○ | |
| `/events/:id` | DELETE | ○ | 403 | |
| `/events/:id/teams` | PUT | ○ | 403 | |
| `/events/:id/respondents` | PUT | ○ | 403 | |
| `/events/:id/formulas` | PUT | ○ | 403 | |
| `/events/:id/formula-results` | GET | ○ | ○ | 横断集計 |
| `/forms` | POST | ○ | 403 | フォーム作成・複製 |
| `/forms/:id` | GET | ○ | ○ | |
| `/forms/:id` | PATCH | ○ | 403 | タイトル・公開切替・種別・シートID |
| `/forms/:id` | DELETE | ○ | 403 | |
| `/forms/:id/preview` | GET | ○ | ○ | プレビューは保存しないので許可 |
| `/forms/:id/questions` | PUT | ○ | 403 | |
| `/forms/:id/responses` | GET | ○ | ○ | |
| `/forms/:id/summary` | GET | ○ | ○ | |
| `/forms/:id/export.csv` | GET | ○ | **○** | 読み取りのみ。集計係の主な用途なので許可 |
| `/forms/:id/sync-sheets` | POST | ○ | **403** | 下記 |
| 未定義パス | GET | 404 | 404 | 認証の内側（今までどおり） |
| 未定義パス | それ以外 | 404 | 403 | ミドルウェアが先に弾く。問題なし |

### sync-sheets と export.csv を個別に決めた理由

- **export.csv は許可する。** D1 を読んで CSV を返すだけで、副作用がない。当日、集計係が手元の Excel で確かめる用途がいちばん多い。
- **sync-sheets は禁止する（403）。** 共有スプレッドシートの「回答」「集計」タブを**全部書き直す**外部への書き込みで、途中で失敗すると一時的にシートが空になりうる。閲覧者が押す必要はない（回答ごとの自動追記は回答 API 側で動き続ける）。POST なので、ミドルウェアの一般規則だけで 403 になる。特別扱いのコードは要らない。

### ADMIN_TOKEN と VIEWER_TOKEN が同じ値のとき

送られた文字列が両方に一致するので、サーバーには誰が送ったか区別できない。**最小権限の側、つまり viewer に倒す。**

- 読み取りは今までどおりでき、書き込みは 403 になる。当日に集計が見られなくなることはない。
- 管理者がログインしても、ヘッダーに「閲覧専用」バッジが出るので設定ミスに気づける。直し方は `wrangler secret put VIEWER_TOKEN` で別の値にするだけ（再デプロイは不要）。
- 採らなかった案:
  - admin に倒す案: 閲覧用として配った人が、黙って削除まで使えてしまう
  - 管理 API 全体を 500 で止める案: 当日に気づいた場合、集計まで見られなくなる

これを operations.md の「困ったとき」の表に 1 行足す。

## API の形

### 追加: `GET /api/admin/me`

ログイン中のトークンの役割を返す。ルートはミドルウェアの直後（`parseIdParam` より前）に置き、ハンドラ群の中には置かない。

```ts
adminRoutes.get('/me', (c) => c.json<AdminMe>({ role: c.get('role') }));
```

役割はログイン時のレスポンスで返すこともできるが、**ログイン用の API は今も存在しない**（`AdminTokenGate` はトークンを localStorage に入れるだけ）。そこで `/me` を 1 本足し、画面を開くたびに呼ぶ。役割をクライアント側に保存しないので、シークレットを変えたときに古い役割が残る事故がない。副次的な効果として、打ち間違えたトークンがログイン直後に 401 で弾かれるようになる（今は最初の一覧取得まで気づけない）。

### 型（`src/shared/types.ts` の末尾、`ApiError` の後に追記）

```ts
// ---------- 管理画面の権限 ----------

export type AdminRole = 'admin' | 'viewer';

export interface AdminMe {
  role: AdminRole;
}
```

### クライアント（`src/client/api.ts`）

- `getAdminMe(): Promise<AdminMe>` を追加する（`request('/api/admin/me', { admin: true })`）
- 403 のための特別な処理は足さない。今の `request()` は、サーバーの `error` 文字列を `ApiRequestError.message` に入れて投げる。各画面の `catch` はそれをトースト（削除・公開切替・複製・シートID・CSV）かインラインのエラー（チーム・回答者・計算式の保存、イベント作成）で表示している。サーバーの文言を日本語にしておけば、そのまま「閲覧専用のトークンでは変更できません」と表示される
- 401 のときにトークンを消す処理（`notifyUnauthorized`）は変えない。403 ではトークンを消さない

## 画面仕様

### 方針

**安全は API が守り、UI は書き込み操作を隠すだけにする。** ボタンを無効化して並べるのではなく、非表示にする。無効化したボタンが並ぶと、閲覧者に「押せないのはなぜか」という問いが残る。閲覧者に要るのは「回答と集計を見る」「CSV を取る」「回答 URL を配る」の 3 つだけ。`window.confirm` 付きの削除が万一呼ばれても API が 403 を返すので、UI 側で二重に守る必要はない。

### 役割の受け渡し

- 新規ファイル `src/client/pages/admin/adminRole.ts`（約 15 行）に `AdminRoleContext` と `useAdminRole(): AdminRole` を置く。Provider の外で使われたときの既定値は `'viewer'`（隠す側に倒す）
- `AdminTokenGate` がトークンの変化をきっかけに `getAdminMe()` を呼び、役割を state に持って `<AdminRoleContext.Provider>` で `<Outlet />` を包む。役割が取れるまでは本文の代わりに「読み込み中…」を出す
- PR #16・#17 と重なるファイル（`FormsSection.tsx`、`ResponsesPanel.tsx`）では hook を import せず、親から `readOnly` プロパティで渡す（import 行の衝突を避けるため）

### 画面ごとの変更（現状 → 閲覧専用のとき）

| 画面 | 現状 | 閲覧専用のとき |
|---|---|---|
| ログイン（`AdminTokenGate`） | 説明「管理トークンを入力してください。」、placeholder「管理トークン」 | 説明を「管理トークン、または閲覧用トークンを入力してください。」、placeholder を「トークン」に変える（役割に関係なく全員に表示） |
| ヘッダー（`AdminTokenGate`） | 「FormNow 管理」と「ログアウト」 | ロゴの右に「閲覧専用」バッジを出す。ロゴとバッジは `.admin-header-left` で囲む |
| イベント一覧（`AdminHome`） | 作成フォーム、各行の「⋯」（削除） | 作成フォームと「⋯」を**非表示**にする。一覧とリンクは残す |
| イベント詳細（`EventDetailPage`） | フォーム一覧、「チームと回答者」、「横断集計と計算式」 | 「チームと回答者」を**丸ごと非表示**にする（編集用の入力欄しかないため）。「横断集計と計算式」は見出しを「横断集計」にし、「計算式」の小見出しと `FormulasTab` を非表示にして、`FormulaResultsPanel` だけ出す |
| フォーム一覧（`FormsSection`、`readOnly` プロパティ） | 「＋ 審査員フォーム」「＋ 相互評価フォーム」、カードの「URLをコピー」と「⋯」（複製・削除） | 作成ボタン 2 つと「⋯」を**非表示**にする。「URLをコピー」とカードをクリックして開く操作は残す。0 件のときの文言は「フォームがまだありません。」だけにする（「上のボタンから作成してください」を出さない） |
| エディタのヘッダー（`FormEditPage`） | 保存状態、公開状態の切替（下書き・公開中・締切）、⚙ 設定、プレビュー、共有、「公開すると回答できます」 | 公開状態の切替の代わりに、今の状態を `status-badge` で表示する（押せない）。⚙ 設定、保存状態の表示、「公開すると回答できます」は**非表示**にする。プレビュー・共有は残す |
| エディタのタブ（`FormEditPage`） | 「質問」「回答」。`?tab=responses` がなければ質問 | タブ列を**非表示**にし、常に `ResponsesPanel` を表示する（URL に `?tab=` がなくても）。質問タブにあるフォームのタイトルが見えなくなるので、代わりに `<h1>{data.form.title}</h1>` を出す |
| 回答タブ（`ResponsesPanel`、`readOnly` プロパティ） | 「CSVダウンロード」「シートへ一括同期」 | 「シートへ一括同期」を**非表示**にする。CSV・ランキング・個別回答は今までどおり |
| プレビュー（`PreviewPage`） | 回答フローを保存なしで表示 | 変更しない（GET だけなので viewer でも動く） |

### 閲覧専用で隠す要素の一覧

1. イベント作成フォーム（`AdminHome`）
2. イベントの「⋯」→ 削除（`AdminHome`）
3. 「＋ 審査員フォーム」「＋ 相互評価フォーム」（`FormsSection`）
4. フォームカードの「⋯」→ 複製・削除（`FormsSection`）
5. 「チームと回答者」セクション全体（`EventDetailPage`）
6. 「計算式」の小見出しと編集欄（`EventDetailPage`）
7. 公開状態の切替ボタン（`FormEditPage`。状態のバッジに置き換える）
8. ⚙ 設定（種別・シートID）（`FormEditPage`）
9. 保存状態の表示と「公開すると回答できます」（`FormEditPage`）
10. 「質問」「回答」のタブ列と質問パネル（`FormEditPage`）
11. 「シートへ一括同期」（`ResponsesPanel`）

### 403 のときの表示

- サーバーの文言: `閲覧専用のトークンでは変更できません`
- 画面: 上に書いたとおり、既存の `catch` がトースト（`toast.show(message, 'error')`）かインラインのエラーでそのまま表示する。UI では書き込み操作を隠しているので、普通は出ない。出るのは、別のタブで管理トークンから閲覧用トークンに入り直した直後に、古いタブで操作した場合くらい
- 403 ではログアウトさせない（トークンは有効なので）

### CSS（`src/client/styles.css`）

「管理画面」セクションの `.admin-brand` の直後（600 行目付近）に追記する。末尾と rating セクションには書かない。

```css
.admin-header-left { display: flex; align-items: center; gap: 10px; }
.role-badge { font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent-dark); }
```

（`--accent-soft` と `--accent-dark` は `:root` で定義済み）

## 受け入れ条件

- [ ] `VIEWER_TOKEN` を設定すると、そのトークンで管理画面にログインでき、ヘッダーに「閲覧専用」と表示される
- [ ] 閲覧専用で、イベント一覧・イベント詳細・フォームの回答タブ（ランキング・個別回答）・横断集計・プレビューが見られる
- [ ] 閲覧専用で CSV をダウンロードできる
- [ ] 閲覧専用では「隠す要素の一覧」の 11 項目が表示されない
- [ ] 閲覧専用でフォームを開くと、URL に `?tab=` がなくても回答タブが表示され、フォームのタイトルが見える
- [ ] 閲覧専用トークンで POST / PUT / PATCH / DELETE を送ると 403 `閲覧専用のトークンでは変更できません` が返り、DB は変わらない
- [ ] 閲覧専用トークンで `sync-sheets` を送ると 403 が返る
- [ ] `VIEWER_TOKEN` が未設定なら、どの文字列でも閲覧専用ログインはできない（401）
- [ ] `ADMIN_TOKEN` では今までどおりすべての操作ができ、画面も今までと同じ（バッジなし）
- [ ] `ADMIN_TOKEN` と `VIEWER_TOKEN` が同じ値なら、`/me` は `viewer` を返し、書き込みは 403 になる
- [ ] `/mcp` は VIEWER_TOKEN では使えない（401）
- [ ] 打ち間違えたトークンでログインすると、すぐにログイン画面に戻る
- [ ] `npm run format:check` / `check` / `test` / `build` が通る

## テスト計画

### 結合テスト（新規ファイル `tests/integration/viewer.test.ts`）

`tests/integration/api.test.ts` は他の PR もテストを足すので触らず、新しいファイルに分ける。

`tests/helpers/app.ts` の変更:

- `export const VIEWER_TOKEN = 'test-viewer-token'` を足し、`createTestClient` の既定の env に `VIEWER_TOKEN` を入れる（`overrides` で上書き・未設定にできる）
- `viewer(method, path, body)` を足す（`admin()` と同じ形で、`Bearer ${VIEWER_TOKEN}` を付ける）

既存テストへの影響: 「シークレットが未設定なら拒否する」テストは `Bearer undefined` と `Bearer ` しか送らないので、VIEWER_TOKEN の既定値が入っても結果は変わらない。

ケース（`seed()` のフィクスチャを使う）:

| # | 内容 | 期待 |
|---|---|---|
| 1 | viewer で `GET /me` | 200 `{ role: 'viewer' }` |
| 2 | admin で `GET /me` | 200 `{ role: 'admin' }` |
| 3 | viewer で GET 各種（`/events`、`/events/:id`、`/events/:id/formula-results`、`/forms/:id`、`/forms/:id/preview`、`/forms/:id/responses`、`/forms/:id/summary`） | すべて 200 |
| 4 | viewer で `GET /forms/:id/export.csv` | 200、`Content-Type` が `text/csv` |
| 5 | viewer で `POST /events`、`POST /forms`、`PUT /events/:id/teams`、`PUT /events/:id/respondents`、`PUT /events/:id/formulas`、`PUT /forms/:id/questions`、`PATCH /forms/:id`、`DELETE /forms/:id`、`DELETE /events/:id` | すべて 403、本文の `error` が `閲覧専用のトークンでは変更できません` |
| 6 | #5 の後、admin で `GET /events/:id` と回答数を確認 | 変わっていない（DELETE が効いていない） |
| 7 | viewer で `POST /forms/:id/sync-sheets` | 403（`GOOGLE_SERVICE_ACCOUNT_JSON` 未設定の 400 ではなく 403 になる。ミドルウェアで弾かれている証拠） |
| 8 | `createTestClient({ VIEWER_TOKEN: undefined })` で `Bearer test-viewer-token` の GET | 401 |
| 9 | `createTestClient({ VIEWER_TOKEN: '' })` で `Bearer ` の GET | 401 |
| 10 | admin で PUT / PATCH / DELETE | 今までどおり 200（`PATCH /forms/:id` の status 変更で代表させる） |
| 11 | `createTestClient({ VIEWER_TOKEN: ADMIN_TOKEN })` で admin トークンの `GET /me` と `PATCH /forms/:id` | `viewer` と 403 |
| 12 | viewer トークンで `POST /mcp` | 401 |

単体テストは足さない。判定は `timingSafeEqual`（テスト済み）とメソッドの比較だけなので、結合テストで十分に確かめられる。

### UI

自動テストはない（現状 UI のテストは存在しない）。下の手動確認で確かめる。

## 手動確認手順

`.dev.vars` に `VIEWER_TOKEN=dev-viewer-token` を足して `npm run dev` を実行する。

1. `/admin` で `dev-admin-token` を入れてログインする。バッジが出ず、今までどおりイベントの作成・フォームの作成・質問の編集・公開切替ができる
2. ログアウトし、`dev-viewer-token` でログインする。ヘッダーに「閲覧専用」が出る
3. イベント一覧に作成フォームも「⋯」もない。イベントを開くと「チームと回答者」がなく、「横断集計」だけがあり、フォームカードに「⋯」と作成ボタンがない。「URLをコピー」は動く
4. フォームカードを開く。タブ列がなく、タイトル・状態バッジ・プレビュー・共有・回答タブの内容が見える。「シートへ一括同期」がない
5. 「CSVダウンロード」でファイルが落ちてくる
6. 「プレビュー」を開き、最後まで回答フローを進められる（保存されないことは今までどおり）
7. 同じ画面のまま、ブラウザの開発者ツールで `fetch('/api/admin/events', {method:'POST', headers:{Authorization:'Bearer dev-viewer-token','Content-Type':'application/json'}, body:'{"name":"x"}'})` を実行すると 403 と日本語の文言が返る
8. `dev-wrong` でログインすると、すぐにログイン画面に戻る
9. `.dev.vars` から `VIEWER_TOKEN` を消して開発サーバーを再起動すると、`dev-viewer-token` ではログインできない
10. スマホ幅（375px）で、ヘッダーのバッジとログアウトが 1 行に収まる

UI を変える PR なので、admin と viewer それぞれのイベント詳細・エディタのスクリーンショットを PR に貼る（回答者の実名は写さない）。

## 運用ドキュメントの変更

| ファイル | 変更 |
|---|---|
| `docs/operations.md` 構成の表 | シークレットの列に `VIEWER_TOKEN`（任意）を足す |
| `docs/operations.md` 初回デプロイ | `npx wrangler secret put VIEWER_TOKEN   # 任意。回答と集計を見るだけの合言葉。ADMIN_TOKEN とは別の値にする` を足す |
| `docs/operations.md` シークレットの変更 | 「閲覧用トークンを配った人が抜けたら `VIEWER_TOKEN` だけ変えればよい（管理者は入り直し不要）」を 1 行足す |
| `docs/operations.md` 当日のチェックリスト | 「当日」に「司会・集計係には `ADMIN_TOKEN` ではなく閲覧用トークン（`VIEWER_TOKEN`）を渡す」を 1 行足す |
| `docs/operations.md` 困ったとき | 「管理トークンで入ったのに『閲覧専用』と出る → `VIEWER_TOKEN` が `ADMIN_TOKEN` と同じ値。別の値に設定し直す」「閲覧専用で『変更できません』と出る → 仕様。変更は管理トークンで」を足す |
| `CONTRIBUTING.md` セットアップ | `.dev.vars` の例に `VIEWER_TOKEN=dev-viewer-token` を足す。「`dev-viewer-token` で入ると閲覧専用の画面を確認できます」を 1 行足す |
| `README.md` 動かしてみる | `printf` の行に `VIEWER_TOKEN=dev-viewer-token` を足す |
| `README.md` 使い方 | 5 番目に「当日の司会・集計係には閲覧用トークン（`VIEWER_TOKEN`）を渡すと、回答と集計を見るだけでき、変更はできません」を足す |
| `docs/architecture.md` 図 | `/api/admin/*   管理API（ADMIN_TOKEN 必須。読み取りだけなら VIEWER_TOKEN も可）` |
| `wrangler.jsonc` コメント | `VIEWER_TOKEN  管理APIの閲覧専用トークン（任意）` を足す |
| `SECURITY.md` | 歓迎する報告に「閲覧専用トークンで書き込み・削除ができる」を足す |

## 差分見積もり

| ファイル | 行数（+/-） |
|---|---|
| `src/worker/env.ts` | +1 |
| `src/worker/routes/admin.ts`（13〜25 行付近のみ） | +20 / -6 |
| `src/shared/types.ts`（末尾） | +8 |
| `src/client/api.ts` | +5 |
| `src/client/pages/admin/adminRole.ts`（新規） | +15 |
| `AdminTokenGate.tsx` | +30 / -6 |
| `AdminHome.tsx` | +8 / -4 |
| `EventDetailPage.tsx` | +15 / -8 |
| `FormsSection.tsx`（Props とJSX のみ） | +10 / -4 |
| `FormEditPage.tsx`（import 1 行・39 行目・ヘッダーとタブの JSX のみ） | +30 / -8 |
| `editor/ResponsesPanel.tsx`（Props と同期ボタンのみ） | +5 / -2 |
| `styles.css`（管理画面セクション内） | +15 |
| `tests/helpers/app.ts` | +6 |
| `tests/integration/viewer.test.ts`（新規） | +120 |
| ドキュメント（operations / CONTRIBUTING / README / architecture / SECURITY / wrangler.jsonc） | +20 / -4 |
| **合計** | **約 +300 / -40（340 行ほど。目安の 400 行以内）** |

## PR #16・#17 との衝突回避

| ファイル | この PR で触る範囲 | 避ける範囲（他 PR） |
|---|---|---|
| `routes/admin.ts` | 13 行目（Hono の型）、17〜24 行目のミドルウェア、その直後に `/me` を追加 | `questionItemSchema`、`PUT /forms/:id/questions` のハンドラ、その他すべてのハンドラ本体（#16） |
| `FormEditPage.tsx` | import 群の**最後**に `useAdminRole` の 1 行を足す。38〜39 行目の `activeTab` の決め方。302〜376 行目のヘッダー・タブ列・パネルの出し分け | 質問の読み込み（61〜90 行目）、保存（130〜191 行目）、追加・複製・移動（193〜259 行目）（#16） |
| `FormsSection.tsx` | `Props` に `readOnly?: boolean`、作成ボタンと「⋯」の JSX（104〜121、154〜162 行目）、0 件のときの文言 | import 群、`handleDuplicate`（55〜86 行目）（#16）。hook は import しない |
| `editor/ResponsesPanel.tsx` | `Props` に `readOnly?: boolean`、同期ボタンの JSX（100〜102 行目） | import 行（#17）。hook は import しない |
| `QuestionEditor.tsx`・`QuestionsPanel.tsx`・`db.ts`・`mcp/tools.ts`・`pages/public/*` | 触らない | — |
| `api.ts` | `getAdminMe` を管理 API の節の先頭（`listEvents` の前）に追加。import 群に `AdminMe` を足す | `QuestionInput`（#16） |
| `shared/types.ts` | 末尾（`ApiError` の後）に追記 | `Question` 周辺（#16 が手を入れる可能性） |
| `styles.css` | 「管理画面」セクションの `.admin-brand` の直後 | 末尾（#17）、rating セクション（#16） |
| `tests/integration/api.test.ts` | 触らない（新規ファイルに分ける） | — |

マージ順は問わない。#16・#17 が先にマージされたら `main` に rebase し、`FormEditPage.tsx` と `api.ts` の import 行で出る衝突を手で解消すれば済む（どちらも 1 行ずつ足すだけ）。PR は積まず、`main` 向けに出す。
