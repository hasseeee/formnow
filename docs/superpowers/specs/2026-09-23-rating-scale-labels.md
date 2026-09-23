# 評価質問の段階ごとの説明・タップ領域・ひな形 仕様書

日付: 2026-09-23
ステータス: 承認済み
承認日: 2026-09-23
ブランチ: `feat/rating-scale-labels`

## 目的

評価（`rating`）質問を、回答者が当日スマホで「数字の意味を推測せずに」「押し間違えずに」答えられるようにする。

1. 評価ボタンの各段階に短い説明（例:「1 = もう少し」「5 = とてもよい」）を付けられるようにする
2. 評価ボタンのタップ領域を 48px 以上にし、6 段階以上ではスマホで 2 段に固定する
3. エディタに評価質問のひな形（段階数と説明を一括で入れるボタン）を置く

## 背景

調査メモ（2026-09-23「Googleフォームの改善点・UI 調査メモ」5章の提案 1・2・12）の要約:

- 現状の評価ボタンは数字だけで、Googleフォームの均等目盛と同じく中間どころか両端の意味も分からない。「少なくとも両端、できれば全段階」に説明を付けるのが推奨されている
- `.rating-btn` は 42px でガイドラインの 48px 未満。10 段階だとスマホで不規則に折り返し、段の境目で押し間違えやすい
- Googleフォームの「星・ハート」に相当する手軽さとして、「5 段階・両端に説明」「10 段階」などのひな形があるとよい

## 範囲外

- 調査メモの提案 3〜7（進捗のチーム名表示、回答中の名前表示、最後のボタン文言、未入力項目へのスクロール、完了画面の採点サマリー）。別 PR `feat/eval-flow-ux` で扱う
- 星・ハートなど数字以外の見た目
- 評価の最小値の変更（常に 1 から。0 始まりや負の値は扱わない）
- CSV・スプレッドシートに説明の文字列を書き出すこと（数値のまま。理由は「API と MCP」の節）
- 集計画面（`ResponsesPanel.tsx`）での説明の表示
- 数値入力（`number`）・選択式への説明の追加

## データモデル

### 判断 1: 説明の持ち方 → 新カラム `scale_labels_json` を採用

| | 案A: `options_json` を rating でも使う | 案B: 新カラム `scale_labels_json`（採用） |
|---|---|---|
| 型の分かりやすさ | `options` が「選べる値（回答はラベル文字列）」と「目盛りの説明（回答は数値）」の 2 つの意味を持つ。`score` は rating では無意味 | `scaleLabels: string[] \| null` で意味が 1 つ |
| zod への影響 | `optionSchema.label` が `min(1)` なので「説明なしの段階」を表せない。型ごとに規則を分ける分岐が必要になり、choice/checkbox の検証まで触る | 1 フィールド追加と、rating 専用の検証関数 1 つ |
| MCP の分かりやすさ | Claude が rating の `options` を「選択肢」と誤解して `[{label:"1"},…]` を渡す恐れがある | フィールド名と説明文だけで用途が伝わる |
| 既存データとの互換 | 既存 rating は `options_json = NULL` なのでそのまま動く | 追加カラムは `NULL` 既定なので既存 rating はそのまま無説明で動く |
| 変更量 | マイグレーション不要。クライアントの質問コピー箇所（3 か所）も既に `options` を運んでいる | マイグレーション 1 本。コピー箇所 3 か所と `db.ts` の列リスト 2 か所に追記が要る |
| その他 | エディタで rating→choice に切り替えると説明がそのまま選択肢に化ける（`handleTypeChange` が `question.options ??` を引き継ぐため） | 型の切り替えで混ざらない |

変更量は案A が少ないが、「1 つの列が型によって別の意味になる」ことは後から読む人・Claude の双方にとって事故の元になる。CONTRIBUTING の「`shared/types.ts` が唯一の契約」を分かりやすく保つため案B を選ぶ。コピー箇所の追記漏れは、クライアントの `QuestionInput.scaleLabels` を必須プロパティにして型チェックで検出する。

### 判断 2: 説明の粒度 → 「段階数と同じ長さの配列」1 形式のみ

- 形は `string[]`（長さ = `maxScore`）だけ。`labels[i]` が値 `i + 1` の説明
- 説明を付けない段階は空文字 `''`。両端だけなら `['もう少し', '', '', '', 'とてもよい']`
- `{min, max}` 形式は作らない。2 形式あると型・検証・表示の分岐が倍になるため。両端だけの用途は空文字で表せる
- すべて空文字（空白のみ含む）の配列は、保存時に `null`（説明なし）へ正規化する。「説明なし」の表し方を `null` の 1 通りに保つため

### 段階数（`maxScore`）と配列の長さが合わないときの扱い

- **サーバー（管理 API・MCP）は拒否する**。黙って切り詰め・埋め合わせをすると、Claude や古い画面が送った値と保存結果が食い違うため
- **エディタは配点上限を確定したときに配列の長さを合わせる**（「エディタ」の節）。サーバーに不一致を送らないのはエディタの責任

### スキーマ

`migrations/0002_question_scale_labels.sql`（新規）:

```sql
-- 評価（rating）質問の段階ごとの説明。JSONの文字列配列、長さ = max_score。NULL は説明なし
ALTER TABLE questions ADD COLUMN scale_labels_json TEXT;
```

`0001_init.sql` は編集しない。

### 型（`src/shared/types.ts`）

```ts
export interface Question {
  // …既存…
  /**
   * 評価（rating）の段階ごとの説明。labels[i] が値 i+1 の説明、長さは maxScore と同じ。
   * 説明を付けない段階は空文字。説明がまったくなければ null。rating 以外は常に null
   */
  scaleLabels: string[] | null;
}
```

- `PublicQuestion` は `Omit<Question, 'weight' | 'options'>` のままで `scaleLabels` を含む（説明は回答者に見せる情報なので公開してよい）。型の定義は変えず、コメントに「段階の説明（scaleLabels）は公開する」と 1 行足す
- `buildPublicFormView`（`services.ts`）は `...rest` で残りを渡しているので変更不要

### 検証と長さ合わせの純関数（`src/shared/scaleLabels.ts`、新規）

サーバー（admin・MCP）とクライアント（エディタ）の両方が同じ規則を使うため `src/shared/` に置く。DB にも HTTP にも React にも依存しない純関数とし、`tests/scaleLabels.test.ts` で単体テストする。順位に影響する計算ではないので `worker/logic/` ではなく、両側から参照できる `shared/` とした。

```ts
export const SCALE_LABEL_MAX_LENGTH = 40;   // 1 つの説明の最大文字数
export const SCALE_LABELS_MAX_STEPS = 100;  // 説明を付けられる段階数の上限（= maxScore の上限）

/** 保存前の検証と正規化。ok なら保存する値（null = 説明なし）を返す */
export function normalizeScaleLabels(q: {
  type: QuestionType;
  maxScore: number | null;
  scaleLabels?: string[] | null;
}): { ok: true; value: string[] | null } | { ok: false; error: string };

/** 段階数を変えたときの配列の長さ合わせ（エディタ用） */
export function resizeScaleLabels(labels: string[] | null, newMax: number | null): string[] | null;
```

`normalizeScaleLabels` の規則（上から順に判定）:

1. `scaleLabels` が `undefined` / `null` → `{ ok: true, value: null }`
2. 各要素を `trim()` する。すべて空文字 → `{ ok: true, value: null }`（型を問わない）
3. `type !== 'rating'` → エラー「scaleLabels は評価（rating）の質問にだけ付けられます」
4. `maxScore` が 1〜100 の整数でない（`null` を含む） → エラー「scaleLabels を付けるには maxScore を 1〜100 の整数にしてください」
5. `scaleLabels.length !== maxScore` → エラー「scaleLabels の数（3）が maxScore（5）と一致しません」
6. それ以外 → `{ ok: true, value: trim 済みの配列 }`

要素ごとの文字数（40 以下）と配列の長さ（100 以下）は zod で先に弾く。

`resizeScaleLabels` の規則:

1. `labels` が `null` → `null`
2. `newMax` が 1〜100 の整数でない → `null`
3. `labels.length === newMax` → `labels` をそのまま返す
4. それ以外は長さ `newMax` の空文字配列を作り、`[0]` に `labels[0]` を入れる。`newMax >= 2` かつ `labels.length >= 2` なら末尾に `labels[labels.length - 1]` を入れる。**途中の段階の説明は消す**（5 段階の「3 = ふつう」は 7 段階では真ん中でなくなるため、引き継ぐと意味がずれる）
5. 結果がすべて空文字なら `null`

## API と MCP

### `db.ts`

- `QuestionRow` に `scale_labels_json: string | null` を追加
- `mapQuestion` で `scaleLabels: row.scale_labels_json ? JSON.parse(...) as string[] : null`
- `QuestionInput` に `scaleLabels?: string[] | null` を追加（省略可にして、既存テストの `db.mergeQuestions` 呼び出しを壊さない）
- `upsertQuestions` と `mergeQuestions` の列リストに `'scale_labels_json'`、値に `i.scaleLabels ? JSON.stringify(i.scaleLabels) : null` を追加（2 か所とも同じ変更。共通化のリファクタリングはこの PR ではしない）
- `db.ts` は検証しない。検証は受け口（admin.ts / tools.ts）で `normalizeScaleLabels` を通した値だけを渡す

### 管理 API（`routes/admin.ts`）

- `questionItemSchema` に追加:
  `scaleLabels: z.array(z.string().max(SCALE_LABEL_MAX_LENGTH)).max(SCALE_LABELS_MAX_STEPS).nullable().optional()`
  （省略可。省略・`null` は「説明なし」。既存のテスト用データや古い画面からの保存がそのまま通る）
- `PUT /api/admin/forms/:id/questions` で zod の後、**書き込む前に**全質問へ `normalizeScaleLabels` をかける。1 件でもエラーなら 400 `{ error: "questions[<添字>]: <メッセージ>" }` を返し、何も保存しない。通ったものは正規化後の値で `upsertQuestions` に渡す
- `GET /api/admin/forms/:id` と `GET /api/admin/forms/:id/preview` は `listQuestions` 経由で自動的に `scaleLabels` を含む（変更不要）

### 回答者向け API（`routes/public.ts`）

- `GET /api/forms/:slug` の `questions[].scaleLabels` に説明が出る。`weight` と選択肢の `score` は引き続き出さない
- 回答の送信・検証は変更しない。rating の回答値は従来どおり数値（0 以上 `maxScore` 以下）。説明の文字列を値として送ったら従来どおり 400（「数値が必要」）

### MCP（`mcp/tools.ts`）

- `set_questions` の各質問に追加:
  ```ts
  scaleLabels: z
    .array(z.string().max(SCALE_LABEL_MAX_LENGTH))
    .max(SCALE_LABELS_MAX_STEPS)
    .nullable()
    .optional()
    .describe(
      '評価（rating）の各段階の説明。1点目から順に maxScore 個並べる。説明を付けない段階は空文字。' +
      '例: maxScore=5 で両端だけなら ["もう少し","","","","とてもよい"]。' +
      'maxScore は1〜100の整数が必要。省略またはnullで説明なし。' +
      'scaleLabels を省略すると既存の説明は消えるので、説明を保ちたいときは get_form の値をそのまま渡す',
    ),
  ```
- ツール全体の説明文の末尾に「rating には scaleLabels で段階ごとの説明を付けられる（回答者に表示される）。」を追記
- ハンドラ: 全質問に `normalizeScaleLabels` をかけ、エラーがあれば `throw new Error(\`${i + 1}件目の質問: ${error}\`)`（`safe()` が `isError: true` にする）。**書き込む前に**全件を検証し、1 件でも失敗したら何も保存しない。items には `scaleLabels: 正規化後の値` を渡す
- 省略時は `null`（説明なし）として保存する。既存の `options` 省略時に `null` になるのと同じ「1 件ごとの丸ごと置き換え」の挙動に揃える
- `get_form` は `listQuestions` の結果をそのまま返すので `scaleLabels` が自動で含まれる（変更不要）

### CSV・スプレッドシート → 数値のまま（変更しない）

`admin.ts` の CSV 出力と `sheets.ts` の `buildResponseDataRow` は回答値の数値をそのまま書く。説明の文字列に置き換えない。理由:

- 集計の主目的は合計・平均で、シート側の数式は数値列を前提にする（調査メモ 2 章「グリッドの回答が文字列で数式が動かない」問題をわざわざ持ち込まない）
- 説明は途中の段階が空のことがあり、列の中で数値と文字列が混ざる
- 必要なら説明は `get_form` や管理画面で確認できる

## 回答画面

対象: `src/client/pages/public/QuestionField.tsx`（`case 'rating'`）と `src/client/styles.css`。プレビューも同じ部品なので自動的に反映される。

### ボタン（`maxScore` が 10 以下）

JSX の形:

```tsx
<div
  className="rating-buttons"
  role="group"
  aria-label="評価"
  style={{ '--rating-count': max, '--rating-cols': cols } as CSSProperties}
>
  {options.map((n) => {
    const label = question.scaleLabels?.[n - 1] ?? '';
    return (
      <button key={n} type="button" aria-pressed={current === n}
        className={`rating-btn${current === n ? ' selected' : ''}`}
        onClick={() => onChange(n)}>
        <span className="rating-num">{n}</span>
        {label && <span className="rating-point-label">{label}</span>}
      </button>
    );
  })}
</div>
```

- `cols = max >= 6 ? Math.ceil(max / 2) : max`
- 説明はボタン要素の中に入れる。説明の部分を押しても選べる（タップ領域が広がる）うえ、読み上げで「5 とてもよい」と数字と説明が一緒に読まれる
- `scaleLabels` が `null` の質問は数字だけ（見た目は今と同じで、大きさだけ 48px になる）
- `aria-pressed` で選択状態を読み上げに伝える
- `role="group"` には `aria-label="評価"` を付け、読み上げでボタンのまとまりの名前が分かるようにする（質問文との `aria-labelledby` 連携は質問ごとの id 付けが要るのでこの PR ではしない）

### レイアウトの切り替え（判断 4）

スマホ幅 375px での評価ボタンの使える幅は 375 − ページ余白 16×2 − カード余白 20×2 − 枠 2 = **約 301px**（360px 幅の端末では約 286px）。

- 5 段階: 48×5 + 間隔 8×4 = 272px → 1 段に収まる
- 6 段階: 48×6 + 8×5 = 328px → 収まらない

調査メモは「7 点以上」としているが、formnow の実寸では 6 段階で溢れるので、**切り替えの閾値は 6 段階以上**とする。

| 段階数 | 画面幅 640px 未満 | 640px 以上（既存のブレークポイント） |
|---|---|---|
| 1〜5 | 1 段 | 1 段 |
| 6〜10 | 2 段固定（列数 = 段階数 ÷ 2 の切り上げ。7 なら 4＋3、10 なら 5＋5） | 1 段（カード内幅 約 566px に 10 個 552px が収まる） |
| 11 以上 | スライダー | スライダー |

CSS だけでは子要素の数から列数を計算できない（`:has()` で数は判定できても「÷2 の切り上げ」ができない）ので、JSX から CSS 変数 `--rating-count`（段階数）と `--rating-cols`（狭い画面の列数）を渡す。

```css
.rating-buttons {
  display: grid;
  grid-template-columns: repeat(var(--rating-cols), minmax(0, 88px));
  gap: 10px 8px;
}
@media (min-width: 640px) {
  .rating-buttons { grid-template-columns: repeat(var(--rating-count), minmax(0, 88px)); }
}
```

（`@media` は既存の「レスポンシブ（タブレット以上）」ブロックに追記する。新しい CSS は既存の `.rating-*` の並びの位置に書き、`styles.css` の末尾には追記しない。「`feat/eval-flow-ux` との衝突回避」の節を参照。）

- `.rating-btn`: 枠・背景なしの縦並びの箱（`display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 48px; padding: 0; background: none; border: none`）
- `.rating-num`: 今の丸いボタンの見た目をここへ移し、`width: 48px; height: 48px`。hover・選択時の色も `.rating-btn:hover .rating-num` / `.rating-btn.selected .rating-num` に移す
- `.rating-btn:focus-visible .rating-num` にフォーカスの輪（`box-shadow: 0 0 0 3px var(--accent-soft)`）を付け、キーボードで位置が分かるようにする
- `.rating-point-label`: `font-size: 0.72rem; line-height: 1.3; color: var(--text-muted); text-align: center; overflow-wrap: anywhere;`。選択中は `color: var(--accent)`
- 長い説明は列の幅で折り返し、その行の高さが伸びる（全ボタンの丸は上揃えのまま）。省略記号で切らない（読めない説明は意味がないため）。長さの抑制はエディタの入力上限 40 文字と「10 文字くらいまで」の案内で行う

### スライダー（`maxScore` が 11 以上）

- 今の `.rating-slider` の下に、左端に `scaleLabels[0]`、右端に `scaleLabels[max - 1]` を小さく出す（`.rating-slider-ends`、`display: flex; justify-content: space-between;` 文字の見た目は `.rating-point-label` と同じ）
- 途中の段階の説明は、配列に入っていてもスライダーでは表示しない（エディタでも 11 段階以上では両端しか入力させない）
- 両端とも空なら `.rating-slider-ends` 自体を出さない

## エディタ

対象: `src/client/pages/admin/QuestionEditor.tsx`、`src/client/api.ts`、`FormEditPage.tsx`、`FormsSection.tsx`。

### 質問の受け渡し

- `api.ts` の `QuestionInput` に `scaleLabels: string[] | null` を**必須**で追加。これで次の 3 か所の書き漏れが型チェックで見つかる
  - `FormEditPage.tsx` の読み込み（`toLocalQuestion({...})`）と保存（`payload`）に `scaleLabels: q.scaleLabels`
  - `FormEditPage.tsx` の `handleAddQuestion` に `scaleLabels: null`
  - `FormsSection.tsx` のフォーム複製に `scaleLabels: q.scaleLabels`（**漏れるとフォームを複製したときに説明が消える**）
- `handleTypeChange`: rating 以外へ切り替えたら `patch.scaleLabels = null`。rating へ切り替えたときも `null`（説明は後から入れる）

### 各段階の説明の入力欄（rating のときだけ）

質問文の下、「配点上限・重み・必須」の行の上に、選択肢エディタと同じ見た目（`.option-editor`）で置く。

```
各段階の説明（任意）
ひな形: [5段階・全部に説明] [5段階・両端だけ] [10段階・両端だけ]
 1 [もう少し            ]
 2 [                    ]
 3 [                    ]
 4 [                    ]
 5 [とてもよい          ]
短く書くと、スマホでも読みやすくなります（10文字くらいまで）
```

- `maxScore` が 1〜10 の整数: `maxScore` 個の入力欄（左に段階の数字）
- `maxScore` が 11〜100 の整数: 「1」と「{maxScore}」の 2 欄だけ。途中の要素は常に空文字
- それ以外（空・小数・101 以上）: 入力欄の代わりに「配点上限を 1〜100 の整数にすると、各段階に説明を付けられます」と表示（ひな形ボタンは出す）
- 入力欄: `className="text-input"`、`maxLength={SCALE_LABEL_MAX_LENGTH}`、プレースホルダーは 1 欄目「例: もう少し」、最後の欄「例: とてもよい」、途中は空
- 入力したら `labels = question.scaleLabels ?? Array(max).fill('')` の該当添字を書き換えて `onChange({ scaleLabels })`。すべて空に戻した配列はそのまま送ってよい（サーバーが `null` にする）
- 文言は「ラベル」「スケール」を使わず「説明」「段階」「ひな形」とする（CONTRIBUTING の「専門用語は避ける」）

### 配点上限の確定を「入力欄を離れたとき」にする

今は配点上限を 1 文字打つたびに `onChange` している。説明の長さ合わせをこのまま毎回かけると、「10」と打ち直す途中の「1」で説明が 1 段階分に縮み、元に戻らない。そこで重みの入力（`weightText` と `commitWeight`）と同じ方式にする。

- `maxScoreText` をローカルに持ち、`onBlur` と Enter で `commitMaxScore()` を呼ぶ。`question.maxScore` が外から変わったら（ひな形など）`useEffect` で同期する
- `commitMaxScore()`:
  1. `''` → `null`、数値にならなければ直前の値に戻して終わり（今の「空なら null」の挙動は維持）
  2. rating のときは `next = resizeScaleLabels(question.scaleLabels, newMax)` を求める
  3. 空でない説明の数が `next` で減るなら `window.confirm('段階の数を変えると、両端以外の説明は消えます。よろしいですか？')`。キャンセルなら `maxScoreText` を元に戻して終わり
  4. `onChange({ maxScore: newMax, scaleLabels: next })`（rating 以外は `{ maxScore: newMax }` のみ）
- 数値入力（`number`）の配点上限も同じ確定方式になる（打鍵ごとの自動保存が離脱時 1 回になるだけで、保存される値は変わらない）

### ひな形（判断 5）

新しい概念は増やさず、`maxScore` と `scaleLabels` を 1 回の `onChange` でまとめて入れるだけのボタン。定数は `QuestionEditor.tsx` 内に置く。

| ボタン | maxScore | scaleLabels |
|---|---|---|
| 5段階・全部に説明 | 5 | `['もう少し', 'やや物足りない', 'ふつう', 'よい', 'とてもよい']` |
| 5段階・両端だけ | 5 | `['もう少し', '', '', '', 'とてもよい']` |
| 10段階・両端だけ | 10 | `['もう少し', '', '', '', '', '', '', '', '', 'とてもよい']` |

- 押したとき、今の説明に空でないものがあり、かつひな形と異なるなら `window.confirm('いまの説明をひな形で置き換えます。よろしいですか？')`
- 質問文・重み・必須は変えない
- 保存はほかの編集と同じく自動保存（800ms の遅延）に乗る

## 受け入れ条件

### データ・型

- [ ] `migrations/0002_question_scale_labels.sql` が追加され、`questions.scale_labels_json TEXT`（NULL 可）を足す。`0001_init.sql` は差分なし
- [ ] `tests/helpers/d1.ts` が 0001 に続いて 0002 も流す
- [ ] `Question` 型に `scaleLabels: string[] | null` があり、コメントに「labels[i] は値 i+1、長さ = maxScore、rating 以外は null」と書かれている
- [ ] `PublicQuestion` は `weight` と `options[].score` を含まず、`scaleLabels` を含む
- [ ] `src/shared/scaleLabels.ts` に `SCALE_LABEL_MAX_LENGTH = 40`、`SCALE_LABELS_MAX_STEPS = 100`、`normalizeScaleLabels`、`resizeScaleLabels` があり、本仕様の規則どおりに動く

### 管理 API

- [ ] rating 質問に長さ `maxScore` の `scaleLabels` を付けて `PUT /questions` すると保存され、応答と `GET /api/admin/forms/:id` に trim 済みの配列が返る
- [ ] `scaleLabels` を省略、または `null` で送ると `null` で保存される（既存の rating 質問は無説明のまま動く）
- [ ] 空文字（空白のみ）だけの配列は `null` で保存される
- [ ] 長さが `maxScore` と違う、`maxScore` が `null`・小数・101 以上、rating 以外に付けた、のどれかなら 400 で、同じリクエストのほかの質問も含め何も保存されない
- [ ] 41 文字以上の説明、101 個以上の配列は 400

### 回答者向け API

- [ ] `GET /api/forms/:slug` と管理者プレビューの `questions[].scaleLabels` に説明が出る。本文に `weight` と `score"` が含まれない
- [ ] 説明付きの rating 質問に数値を送ると従来どおり保存され、説明の文字列を送ると 400

### MCP

- [ ] `set_questions` の入力スキーマに `scaleLabels` があり、説明文に「1 点目から順に maxScore 個」「空文字で説明なし」「省略で説明なし」「説明を保ちたいときは get_form の値をそのまま渡す」が書かれている
- [ ] `set_questions` で付けた説明が `get_form` の出力に出る
- [ ] 長さ不一致などの誤りは `isError: true` で「何件目の質問か」と理由が返り、何も保存されない

### CSV・シート

- [ ] 説明付きの rating 質問でも、CSV とシートの回答列は数値のまま（`admin.ts` の CSV 出力と `sheets.ts` に差分なし）

### 回答画面

- [ ] `.rating-num` の丸が 48×48px 以上
- [ ] 幅 375px で、5 段階は 1 段、6〜10 段階は 2 段（10 なら 5＋5、7 なら 4＋3）
- [ ] 幅 640px 以上で、10 段階まで 1 段
- [ ] 説明はボタンの下に出て、説明部分を押しても選べる。説明がない段階は数字だけ
- [ ] 長い説明は折り返して全文読める（省略されない）
- [ ] 11 段階以上のスライダーでは、両端の説明が左右の端の下に出る。両端とも空なら何も出ない
- [ ] 説明のない既存の rating 質問は、大きさ以外は今と同じ見た目
- [ ] Tab でボタンに移るとフォーカスの輪が見え、Enter / Space で選べる
- [ ] `.rating-buttons` に `role="group"` と `aria-label="評価"` が付いている

### エディタ

- [ ] rating を選ぶと「各段階の説明（任意）」とひな形 3 つが出る。ほかの型では出ない
- [ ] 1〜10 段階は段階の数だけ、11〜100 段階は両端の 2 欄だけ入力欄が出る
- [ ] ひな形を押すと配点上限と説明がまとめて入り、自動保存される。説明を書いてあるときは確認が出る
- [ ] 配点上限は入力欄を離れた（または Enter）ときに確定する。5→7 に変えると両端の説明が残り、途中が消える。途中に説明があったときは確認が出て、キャンセルすると元の値に戻る
- [ ] rating から別の型へ切り替えると説明は消え、保存が 400 にならない
- [ ] フォームを複製すると説明も複製される
- [ ] 画面の文言に「ラベル」「スケール」「プリセット」が出てこない

### 全体

- [ ] `npm run format:check` / `npm run check` / `npm test` / `npm run build` が通る
- [ ] 提案 3〜7 の変更（`TeamEvaluationStep.tsx` / `FormFlow.tsx` / `CompletionStep.tsx`）を含まない

## テスト計画

### 単体テスト（`tests/scaleLabels.test.ts`、新規）

`normalizeScaleLabels`:
- `undefined` / `null` → `value: null`
- すべて空白の配列 → `value: null`（rating 以外の型でも ok）
- 前後の空白を trim して返す
- rating 以外に空でない説明 → エラー
- `maxScore` が `null` / `4.5` / `0` / `101` → エラー
- 長さ不一致 → エラー（メッセージに両方の数が入る）
- 正しい配列 → そのまま（trim 済み）

`resizeScaleLabels`:
- `null` → `null`
- 同じ長さ → 同じ配列
- 5→10: 両端が残り途中は空
- 10→5: 両端が残り途中は空
- 長さ 1 → 5: 先頭だけ残り、末尾に先頭がコピーされない
- `newMax` が `null` / 小数 / 101 → `null`
- 結果が全部空 → `null`

既存の `tests/scoring.test.ts` / `aggregate.test.ts` / `sheets.test.ts` の `makeQuestion` に `scaleLabels: null` を 1 行ずつ足す（型エラー回避。計算の期待値は変わらない）。

### 結合テスト（`tests/integration/api.test.ts` に `describe('評価の段階の説明')` を追加）

1. 管理 API で技術力（10 段階）に `['  もう少し ', '', …, 'とてもよい']` を付けて保存 → 応答と `GET /api/admin/forms/:id` で trim 済みで往復する
2. `seed()` のまま（`scaleLabels` を送っていない）の質問は `scaleLabels: null`
3. 空文字だけの配列 → `null`
4. 長さ不一致 → 400。続けて `GET` すると質問（ほかの質問の変更も含め）が元のまま
5. `textarea` 質問に説明 → 400
6. `GET /api/forms/judge` の本文に説明の文字列があり、`weight` と `score"` がない。プレビューも同様
7. 説明付き質問に `value: 8` を送る → 200。`value: 'とてもよい'` → 400
8. MCP `set_questions`（`/mcp` に JSON-RPC の `tools/call` を POST）で説明を付ける → `get_form` に出る。長さ不一致なら `isError: true` で、DB の質問は変わらない

MCP の呼び出しは、`/mcp` に `{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments } }` を `Accept: application/json, text/event-stream` と `Authorization: Bearer ${MCP_TOKEN}` 付きで送ると、ステートレスモードのため initialize なしで `text/event-stream` の `data: {...}` 1 行が返る（手元で確認済み）。テスト内に小さな補助関数 `callTool(name, args)` を作り、`data:` 行の JSON の `result` を返す。

## 手動確認手順

UI にはテストがないので、次を `npm run dev` で確認し、スクリーンショット（スマホ幅と PC 幅）を PR に貼る。

1. `npm run db:migrate:local`（0002 が適用されることを確認）→ `npm run dev`
2. `http://localhost:5173/admin` に `dev-admin-token` でログインし、イベント・チーム・審査員を用意してフォームを作る
3. 評価の質問を追加し「5段階・全部に説明」を押す → 配点上限 5、説明 5 つが入る。数秒後に保存済みになり、再読み込みしても残る
4. 1 つの説明を書き換えてから「10段階・両端だけ」を押す → 確認が出る。OK で 10 段階・両端だけになる
5. 配点上限を 10 → 7 に打ち直して欄を離れる → 途中に説明がなければ確認なしで 7 欄（両端のみ）。途中に説明を書いてから 7 → 5 にすると確認が出て、キャンセルで 7 に戻る
6. 配点上限を 20 にする → 入力欄が「1」「20」の 2 つだけになる
7. 型を「単一選択」に変えて戻す → 説明が消えていて、保存エラーにならない
8. プレビューを開き、ブラウザの開発者ツールで幅 375px にする
   - 5 段階: 1 段、丸が 48px（開発者ツールの計測で確認）、説明がボタンの下
   - 幅を 360px にしても 5 段階が 1 段に収まる（48×5 + 8×4 = 272 ≤ 約 286）
   - 7 段階: 4＋3 の 2 段、10 段階: 5＋5 の 2 段
   - 説明の文字をタップしても選べる
   - 40 文字近い説明を入れて、折り返して全文読めること
9. 幅を 640px 以上にする → 10 段階が 1 段
10. 配点上限 20 のスライダー → 両端の下に説明が出る
11. 説明を付けていない評価質問 → 数字だけ、大きさ以外は今と同じ
12. Tab キーでボタンを移動し、フォーカスの輪が見え、Space で選べる
13. フォームを公開して `/f/<URL名>` で回答 → 保存できる。管理画面の CSV を落とし、その列が数値であること
14. フォーム一覧の「複製」→ 複製先でも説明が残っている

本番反映時は `docs/operations.md` のとおり、バックアップ → `npm run db:migrate:remote` → デプロイの順（新しいコードが新しい列を前提にするため）。PR 本文にマイグレーションがあることを明記する。

## `feat/eval-flow-ux` との衝突回避

同時に進む別 PR `feat/eval-flow-ux`（提案 3〜7）と同じファイルを触っても衝突しないよう、触る範囲を分ける。

| ファイル | `feat/eval-flow-ux`（相手） | この PR |
|---|---|---|
| `src/client/pages/public/QuestionField.tsx` | 触らない | `case 'rating'` を変更 |
| `src/client/styles.css` | 末尾への追記のみ。`.rating-*` は触らない | 既存の rating セクション（`.rating-buttons` 〜 `.rating-slider.unanswered …`）の書き換え・追記と、既存の `@media (min-width: 640px)` ブロックへの追記に留める。**末尾には追記しない** |
| `src/shared/` | `evalFlow.ts` と `plainText.ts` を新規追加 | `scaleLabels.ts` を新規追加（`types.ts` への追記のみ） |

- 受け入れ条件: `git diff main -- src/client/styles.css` の変更が rating セクションと `@media (min-width: 640px)` ブロックの中だけにあり、ファイル末尾に行が増えていない
- 先にマージされた側に合わせて、後の側は `main` を取り込んでから出す（PR は積まない）

## 差分見積もり

| ファイル | 追加・変更行（目安） |
|---|---|
| `migrations/0002_question_scale_labels.sql` | 2 |
| `src/shared/types.ts` | 6 |
| `src/shared/scaleLabels.ts`（新規） | 50 |
| `src/worker/db.ts` | 10 |
| `src/worker/routes/admin.ts` | 12 |
| `src/worker/mcp/tools.ts` | 20 |
| `src/client/api.ts` / `FormEditPage.tsx` / `FormsSection.tsx` | 5 |
| `src/client/pages/public/QuestionField.tsx` | 40 |
| `src/client/pages/admin/QuestionEditor.tsx` | 100 |
| `src/client/styles.css` | 55 |
| **本体 小計** | **約 300** |
| `tests/scaleLabels.test.ts`（新規） | 60 |
| `tests/integration/api.test.ts` | 100 |
| `tests/helpers/d1.ts`、`makeQuestion` ×3 | 6 |
| **テスト 小計** | **約 165** |
| **合計** | **約 465**（この仕様書を除く） |

目安の 400 行を 1〜2 割超える見込み。約 465 行はレビューで許容済み。

**今回は削らず、PR 本文で目安超過の理由（マイグレーション＋API＋MCP＋UI が 1 機能として不可分、テスト 165 行を含む）を明記する。**

参考として検討した削る候補（今回は採らない）:

1. ひな形を 2 つにする（「5段階・全部に説明」と「10段階・両端だけ」を残す）… 約 5 行
2. ひな形の上書き確認ダイアログをやめる（ひな形は押し直せばよいので影響が小さい）… 約 8 行
3. スライダーの両端の説明表示をやめる（11 段階以上は実運用でまれ。エディタも 11 段階以上では説明欄を出さない）… 約 25 行
4. ~~提案 2（48px と 2 段レイアウト）を先に単独 PR にする~~ → 採らない（レビューで不採用）
