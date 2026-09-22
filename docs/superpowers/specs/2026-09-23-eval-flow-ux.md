# 回答画面の流れの改善（ステップ表示・名前表示・完了サマリーほか）設計書

日付: 2026-09-23
ステータス: 承認済み（承認日 2026-09-23）
ブランチ: `feat/eval-flow-ux`
関連: [Googleフォーム UI 調査メモ](../../research/2026-09-23-google-forms-ux-research.md) の「5. formnow への具体的提案」3〜7

## 目的

審査員・メンバーが当日スマホで評価するときの「いまどこを評価しているか分からない」「誰として回答しているか分からない」「押したら何が起きるか分からない」「どこが未入力か分からない」「付けた点を見直せない」を解消する。計算・API・DB は変えず、回答画面（`src/client/pages/public/`）の表示と遷移だけを変える。

## 背景

- 調査メモ 3.2 節: 5 ステップ以上の進捗は「%」より名前付きインジケーターが良く、送信ボタンは結果が分かるラベルにし、バリデーションはステップ内で分かるように出すのがベストプラクティス。
- 調査メモ 2 節・3.3 節: 審査ツールでは「審査員ごとの対象一覧」と「名前の取り違え防止」が効き、確認画面に自分の採点を出すと見直しと納得感につながる。
- 現状の formnow は「3 / 5 チーム目」の文字だけ・ボタン文言が常に同じ・エラー時に画面が動かない・完了画面はチーム名のリンクだけ、で上記を満たしていない。

## 範囲外

- **評価ボタン（rating）の見た目・ラベル・タップ領域・プリセット**（調査メモ提案 1・2・12）。別 PR `feat/rating-scale-labels` で扱う。
  - この PR では `QuestionField.tsx` を**一切編集しない**（rating 以外の部分も含めてファイルごと触らない）。
  - `styles.css` の `.rating-*` ルールには触れない。追加ルールはすべて**ファイル末尾の新セクション**にまとめ、既存ルールの書き換えはしない。
- `src/shared/types.ts`・API・DB の変更。`src/worker/` は `csv.ts` の `stripMarkdown` を `src/shared/plainText.ts` へ移して再エクスポートにする分（画面仕様 5）以外は変更しない。
- 重み付きの「点数」の表示（回答者には重みを渡さない設計のため。`PublicQuestion` を変えない）。
- 保存していない入力を端末（localStorage）に残すこと。リロードで消えるのは現状どおり。
- 完了画面から開いたチームを「保存せずに完了画面へ戻る」ボタン（下記「ボタン文言」参照。同じ内容で保存し直しても上書きなので実害はない。要望が出たら別 PR）。
- React のテスト基盤（Testing Library・jsdom など）の導入。

## 画面仕様

以下、「評価画面」= `phase === 'evaluating'`、「完了画面」= `phase === 'done'` を指す。すべて `FormFlow` の中で完結するため、本番（`PublicFormPage`）とプレビュー（`PreviewPage`）で同じ表示・同じ動きになる。

### 1. チーム名付きステップ表示（提案 3）

**現状**: カード上部に `progressLabel`（例「3 / 5 チーム目」）の文字だけ。ほかのチームへは「前のチームへ」で 1 つずつ戻るしかない。完了画面にだけチーム一覧がある。

**変更後**:

- 評価画面のヘッダー（`form-header`）と評価カード（`eval-card`）の間に、評価対象チームの一覧を**横一列のチップ列**で常設する（新コンポーネント `TeamStepNav`）。
  - 並び順は `targetTeams`（`sortOrder` 順、相互評価は自チーム除外済み）と同じ。
  - 各チップの状態は 3 つ。優先順位は「評価中 > 済み > 未回答」。

    | 状態 | 条件 | 見た目 | 読み上げ名（`aria-label`） |
    |---|---|---|---|
    | 評価中 | `index === currentIndex` | アクセント色の塗り、白文字 | 「A班、評価中」 |
    | 済み | `completedTeamIds` に含まれる | 緑の ✓ ＋チーム名、白地 | 「A班、評価済み」 |
    | 未回答 | 上記以外 | 枠線のみ、チーム名は通常色 | 「A班、未回答」 |

    済みのチームを修正中のときも「評価中」で表示する。
  - チップ列の上に小さく「評価済み 2 / 5」を出す（`completedTeamIds` のうち `targetTeams` に含まれる数 / `targetTeams.length`）。
- **ジャンプ**: 評価中以外のチップはすべてタップで開ける（**未回答の先のチームにも飛べる**）。
  - 理由: 当日の発表順が登録順とずれる・欠席チームを飛ばす、は普通に起きる。回答は「回答者 × チーム」で独立に upsert されるので、順番を強制する技術的理由がない。
  - 保存中（`submitting`）はチップを押せない（`disabled`）。
  - 評価中のチップを押しても何も起きない。
- **保存後の遷移先**を「最初の未回答チーム」から「**今のチームより後ろの最初の未回答チーム。後ろになければ先頭から探す**」に変える（`findNextTeamIndex`）。未回答がなければ完了画面へ。
  - 理由: 欠席チーム（2 番目）を飛ばして 4 番目を保存したとき、「最初の未回答」だと毎回 2 番目に引き戻されてしまう。
  - ジャンプを使わない従来の流れ（先頭から順に保存）では、今のチームより前は必ず済みなので、遷移先は従来と同じになる。
- **入力途中の内容を保持する**: チップや「前のチームへ」でチームを移っても、保存していない入力は画面を開いている間は残す（`FormFlow` が `drafts` として持つ）。保存に成功したチームの `drafts` は消す。「別の名前で回答する」で全部消す。リロードでは消える（範囲外）。
  - 理由: チップを誤タップしただけで入力が消えると、ジャンプを許したことが事故の原因になる。
- チーム数が多いとき（10〜20）:
  - 1 行のまま横スクロール（`overflow-x: auto`）。折り返さないので、チーム数によらずチップ列の高さは一定（質問が下に押し出されない）。
  - チップの幅は最大 `10em`、はみ出すチーム名は `…` で省略し、`title` に全名を入れる。
  - 評価中のチップが見えるように、チームが切り替わるたびにチップ列の横スクロール位置を「評価中のチップが中央に来る位置」に合わせる。**`scrollIntoView` は使わず**、チップ列要素の `scrollLeft` を計算して設定する（`scrollIntoView` だと画面全体が縦に動くことがあるため）。
  - 幅 375px のスマホでは 3〜4 個が見え、残りは横スクロールで見える、が目安。
- `targetTeams.length <= 1` のときはチップ列を出さない（1 チームだけなら不要）。
- 既存の `progressLabel`（「3 / 5 チーム目」）は**そのまま残す**。チーム名のすぐ上にあり、今のチームの位置を示す役割はジャンプ後も正しい。文字列・表示位置とも変えない。
- **チームが切り替わったら画面の一番上に戻す**（`window.scrollTo(0, 0)`）。現状は保存後に次のチームが「前のチームの保存ボタンを押した位置」のまま表示される。チップでのジャンプを加えるとこの問題が目立つので、この PR で合わせて直す。完了画面に切り替わったときも同様。

### 2. 回答中の名前を常時表示（提案 4）

**現状**: ヘッダーに「別の名前で回答する」リンクだけがあり、誰として回答しているかは画面に出ない。

**変更後**:

- 評価画面のヘッダーで、説明文（Markdown）の下に 1 行で次を並べる（新しい囲み `respondent-bar`）。
  - 「**山田 太郎** さんとして回答中」（名前は太字）
  - その右に既存の「別の名前で回答する」ボタン（クラス・文言・動作は現状のまま）。幅が足りなければ折り返す。
- 名前は `view.respondents.find((r) => r.id === respondentId)?.name`。見つからない場合（通常は起きない）は名前の行を出さず、ボタンだけ出す。
- 完了画面にも名前を出す（下記 5）。
- 名前選択画面（`NameSelectStep`）は変更しない。

### 3. ボタン文言（提案 5）

**現状**: 送信ボタンは常に「このチームの評価を保存して次へ」（保存中は「保存中…」）。

**変更後**: `FormFlow` が状況を 4 つに分けて文言を決め、`TeamEvaluationStep` に渡す。

| 種類（`SubmitMode`） | 条件 | ボタン文言 |
|---|---|---|
| `next` | 今のチームは未回答、かつ他にも未回答チームがある | このチームの評価を保存して次へ（現状どおり） |
| `finish` | 今のチームは未回答、かつ**保存すると未回答が 0 になる** | 保存して完了 |
| `edit-next` | 今のチームは済み（修正）、かつ他に未回答チームがある | 修正を保存して次へ |
| `edit-finish` | 今のチームは済み（修正）、かつ他に未回答チームがない（完了画面から開いたときなど） | 修正を保存して完了画面へ |

- 保存中は 4 種とも「保存中…」（現状どおり）。
- **判定は `currentIndex` ではなく `completedTeamIds` 基準**で行う。「一番最後のチーム（`currentIndex === targetTeams.length - 1`）」かどうかでは決めない。理由:
  - ジャンプで最後のチームを先に評価することがある（最後のチームでも未回答が残る）。
  - リロードで再開したとき、後ろのチームが既に済みのことがある（途中のチームでも保存すると完了する）。
  - `completedTeamIds` には `targetTeams` に含まれないチーム ID（相互評価の自チームなど、サーバーに回答が残っているもの）が入りうるので、判定は必ず `targetTeams` の上で行う。
- 判定式: 「今のチーム以外の `targetTeams` がすべて `completedTeamIds` に含まれるか」＝保存後に未回答が残らないか。これと「今のチームが `completedTeamIds` に含まれるか」の組み合わせで 4 種を決める。
- 文言と遷移先は必ず一致する（`finish` / `edit-finish` のとき保存後は完了画面、`next` / `edit-next` のときは `findNextTeamIndex` の先）。
- 「前のチームへ」ボタンは現状どおり（`currentIndex > 0` のとき表示、1 つ前のチームへ）。
- ボタンに `aria-label` は付けない（見えている文言がそのまま読み上げ名になり、見た目と読み上げがずれないため）。

### 4. エラー時に最初の未入力項目までスクロール（提案 6）

**現状**: `validate()` が失敗すると各項目の下に「必須項目です」、ボタンの上に「未入力の必須項目があります。…」が出るが、画面は動かない。質問が多いと、どこが未入力か画面外で見えない。

**変更後**:

- 保存ボタンを押して `validate()` が失敗したら、**画面の中で一番上にあるエラー項目**を画面の縦中央までスクロールし、その項目の最初の入力部品にフォーカスを当てる。
- エラー項目の見つけ方（`QuestionField.tsx` は触らない前提）:
  - `QuestionField` は既にエラー時に外枠 `div` へ `has-error` クラスを付けている（`question-field has-error`）。これを目印にする。
  - `TeamEvaluationStep` の `.eval-questions` の `div` に `ref` を付け、`ref.current.querySelector('.question-field.has-error')` で最初のエラー項目を得る（DOM 順＝質問の並び順なので「最初」が正しく取れる）。
  - `QuestionField` を `data-question-id` 付きの `div` で包む方法は**採らない**。包むと既存の `.question-field:last-child`（最後の項目だけ下線を消す）が全項目に当たり、見た目が崩れるため。
- タイミング: エラー表示（`has-error`）は `setErrors` の次の描画で DOM に出るので、`handleSubmit` の中では探さない。`TeamEvaluationStep` に「スクロール要求」の数値 state（検証失敗のたびに +1）を持ち、`useEffect` でそれが変わったら探してスクロールする。
- スクロール: `el.scrollIntoView({ block: 'center', behavior })`。`behavior` は `prefers-reduced-motion: reduce` のとき `'auto'`、それ以外は `'smooth'`。`block: 'center'` にするのは、プレビュー画面の上部に固定表示のバナー（`.preview-banner`, `position: fixed`）があり、`'start'` だと項目がバナーの下に隠れるため。
- フォーカス: エラー項目の中の最初の `input, textarea, select, button` に `focus({ preventScroll: true })`（先にフォーカス、次にスクロールの順）。rating なら「1」のボタン、選択肢なら最初のラジオにフォーカスが乗るが、`focus()` では値は変わらない。
- 画面上部のメッセージ「未入力の必須項目があります。…」（`.form-error`）は残し、`role="alert"` を付けて読み上げられるようにする。保存失敗（通信エラー）のメッセージも同じ要素なので同様に読み上げられる。通信エラーのときはスクロールしない。
- 数値の範囲外エラー（「0〜10点で入力してください」）も `has-error` になるので、同じくスクロール対象になる。

### 5. 完了画面に自分の採点サマリー（提案 7）

**現状**: 「全チームの評価が完了しました」＋「回答を修正したい場合は、下のチームを選んでください。」＋チームごとの「A班 の回答を修正する」リンク＋「別の名前で回答する」。

**変更後**:

- 見出し「全チームの評価が完了しました」と 🎉 は残す。
- 見出しの下に「**山田 太郎** さんの回答」（名前が引けないときは出さない）と、説明文「付けた点数を見直せます。直したいチームは「修正する」を押してください。」。
- 既存のチームごとのリンク一覧を、**チームごとのサマリー一覧に置き換える**（チームを選んで修正する機能はこの一覧に統合する）。1 チーム 1 行（カード内の区切り付きリスト）:

  ```
  A班                                   [修正する]
  技術 4/5   デザイン 5/5   発表 3/5   加点 2/10
  ```

  - 1 段目: チーム名（太字）と「修正する」ボタン（`btn btn-link`）。ボタンには `aria-label="A班の回答を修正する"`（見えている「修正する」を含むので見た目と読み上げがずれない）。
  - 2 段目: その回答者がそのチームに付けた値を、**`rating` と `number` の質問だけ**、質問の並び順（`sortOrder`）で並べる。各項目は「質問ラベル 値/上限」。
    - 上限（`maxScore`）が `null` の `number` は「/上限」を付けない。rating は `maxScore ?? 5`（`QuestionField` の rating と同じ既定値）を上限として表示する。
    - 値は `formatScore`（`src/client/lib/format.ts`、小数 2 桁まで・末尾の 0 を削る）で表示。
    - 未回答（任意項目を空で保存した、など）は「—」。
    - `choice` / `checkbox` / `text` / `textarea` は出さない。
  - `rating` / `number` の質問が 1 つもないフォームでは 2 段目を出さず、チーム名と「修正する」だけにする（＝現状の一覧と同等）。
  - 合計や平均は出さない（重みを回答者に渡していないので、表示しても実際の点数と一致しない）。
- 「別の名前で回答する」ボタンは現状どおり最下部。
- 左寄せにする（現状の `.completion-card` は中央揃え。サマリー一覧だけ左寄せ）。
- **質問ラベルの平文化と `stripMarkdown` の一本化**（この PR で行う小さな統合）: `labelMd` は Markdown なので記号を取り除いて表示する。
  - `src/worker/logic/csv.ts` の `stripMarkdown`（コードブロック・インラインコード・画像・リンク・見出し・強調・引用・箇条書きを扱う版。`tests/csv.test.ts` でテスト済み）を **`src/shared/plainText.ts` へ中身を変えずに移動**する。
  - `csv.ts` には `export { stripMarkdown } from '../../shared/plainText';` を残して再エクスポートにする。`src/worker/sheets.ts`・`src/worker/routes/admin.ts`・`tests/csv.test.ts` の import は変えずにそのまま動く。
  - `src/client/pages/admin/editor/ResponsesPanel.tsx` のローカルの簡易版 `stripMarkdown`（記号を空白に置き換えるだけ）は削除し、`src/shared/plainText` から import する。
  - この結果、管理画面「回答」タブの質問見出しは簡易版より正確になる（例: `技術-力` が `技術 力` にならない、`[資料](https://…)` がリンク文字だけになる）。回答画面の完了サマリー・管理画面・CSV・スプレッドシートで同じ平文化になる。
  - 置き場所を `src/shared/` にする理由: `src/shared` は `tsconfig.client.json` と `tsconfig.worker.json` の両方の `include` に既に入っており、設定を変えずに client・worker・`tests/` のどこからでも読み込める。`feat/rating-scale-labels` も `src/shared/scaleLabels.ts` を置くので、「DOM・React に依存しない純関数は `src/shared/` に置く」で揃える。
  - 平文化したラベルが 12 文字を超えたら 12 文字＋「…」に省略し、項目の `title` に省略前の全文を入れる。平文化して空になったら「質問1」のように並び順の番号で表す（質問 ID は回答者に意味がないので出さない）。
- **データはすでに揃っていて API 変更は不要**:
  - `FormFlow` の `answersByTeam: Record<teamId, AnswerMap>` は、名前選択後に `loadInitialResponses`（本番は `GET /api/forms/:slug/responses?respondentId=` の `MyResponsesView` を `PublicFormPage` が変換したもの）で埋まり、保存成功のたびに `handleSubmitTeam` で更新される。
  - プレビューは `loadInitialResponses` が常に `{}` を返し、保存は何もしないが、`answersByTeam` の更新は `FormFlow` 側で行われるので、プレビューでもサマリーが出る。
  - 質問の型・上限・ラベルは `view.questions`（`PublicQuestion`、`type` / `maxScore` / `labelMd` / `sortOrder` を含む。重みは含まない）にある。
  - 完了画面で使うのは `targetTeams`・`questions`・`answersByTeam` の 3 つだけ。

### 6. アクセシビリティ（まとめ）

- チップ列: `<nav aria-label="評価するチーム">` の中に `<ol>`。評価中のチップの `button` に `aria-current="step"`。各チップの `aria-label` は「チーム名、状態」（表の通り）。チェックマークなどの記号は `aria-hidden="true"`。
- チップは `button type="button"`。キーボードで Tab 移動・Enter/Space で開ける。フォーカス時は `:focus-visible` で輪郭を出す。
- チップの高さは最低 44px（タップしやすさ）。
- 送信ボタン: `aria-label` なし（見えている文言＝読み上げ名）。
- エラー: `.form-error` に `role="alert"`、最初のエラー項目にフォーカス移動。
- 完了画面の「修正する」: `aria-label="<チーム名>の回答を修正する"`。
- 色だけに頼らない: 済みは ✓、評価中は塗り＋太字、未回答は枠線、と形でも区別する。

## コンポーネント構成と責務

「プレビューと本番の回答画面は同じ部品」（`docs/architecture.md`）を守るため、**変更はすべて `FormFlow` とその子に閉じる**。`PublicFormPage.tsx` と `PreviewPage.tsx` は変更しない（`FormFlowProps` も変えない）。

| ファイル | 種別 | 責務・変更内容 |
|---|---|---|
| `src/shared/evalFlow.ts` | 新規 | 画面から切り離した純関数（下記）。DOM・React・`window` を使わない |
| `src/shared/plainText.ts` | 新規 | `stripMarkdown`（`src/worker/logic/csv.ts` から中身を変えずに移動）。DOM・React・`window` を使わない |
| `src/worker/logic/csv.ts` | 変更 | `stripMarkdown` の本体を削除し、`export { stripMarkdown } from '../../shared/plainText';` で再エクスポート |
| `src/client/pages/public/TeamStepNav.tsx` | 新規 | チップ列の表示。状態はすべて props で受け取る（自前の state はスクロール位置合わせ用の `ref` のみ） |
| `src/client/pages/public/FormFlow.tsx` | 変更 | `drafts` state の追加、保存後の遷移先を `findNextTeamIndex` に、`SubmitMode` から文言を決めて渡す、名前の表示、`TeamStepNav` の配置、チーム切替時の `scrollTo(0, 0)`、完了画面へサマリーと名前を渡す |
| `src/client/pages/public/TeamEvaluationStep.tsx` | 変更 | props に `submitLabel: string` と `onAnswersChange?: (answers: AnswerMap) => void` を追加。ボタン文言を `submitLabel` に。エラー時のスクロール・フォーカス。`.form-error` に `role="alert"` |
| `src/client/pages/public/CompletionStep.tsx` | 変更 | props を `{ rows: TeamAnswerSummary[]; respondentName: string \| null; onEditTeam; onResetRespondent }` に変更（`teams` は `rows` に置き換え）。サマリー一覧の表示 |
| `src/client/pages/admin/editor/ResponsesPanel.tsx` | 変更 | ローカルの簡易版 `stripMarkdown` を削除し `src/shared/plainText` から import（見出しの平文化が正確になる。画面仕様 5） |
| `src/client/styles.css` | 変更 | **末尾に新セクション**「回答フロー: ステップ表示・名前・完了サマリー」を追加。既存ルールは編集しない |
| `tests/evalFlow.test.ts` | 新規 | 純関数の単体テスト |
| `QuestionField.tsx` / `NameSelectStep.tsx` / `PublicFormPage.tsx` / `PreviewPage.tsx` / `src/shared/types.ts` / `tsconfig*.json` / `vitest.config.ts` | 変更なし | |

### `src/shared/evalFlow.ts` の関数

`AnswerMap` は `TeamEvaluationStep.tsx`（React のファイル）で定義されているため、ここでは読み込まず、同じ形を `./types` の `AnswerValue` から書く。ラベルの平文化は同じ `src/shared/` の `./plainText` を使う。

```ts
import { stripMarkdown } from './plainText';
import type { AnswerValue, PublicQuestion, Team } from './types';

type Answers = Record<number, AnswerValue | null>;

/** fromIndex より後ろの最初の未回答チーム。なければ先頭から探す。全部済みなら -1。
 *  初回の再開位置は fromIndex = -1 で呼ぶ（先頭から探す＝現状の findIndex と同じ）。 */
export function findNextTeamIndex(
  teams: Pick<Team, 'id'>[], completed: ReadonlySet<number>, fromIndex: number,
): number;

export type SubmitMode = 'next' | 'finish' | 'edit-next' | 'edit-finish';
/** 表「ボタン文言」の判定。teams に含まれない completed の ID は無視する */
export function getSubmitMode(
  teams: Pick<Team, 'id'>[], completed: ReadonlySet<number>, currentTeamId: number,
): SubmitMode;

export type TeamStepStatus = 'current' | 'done' | 'todo';
export function getTeamStepStatus(
  teamId: number, index: number, currentIndex: number, completed: ReadonlySet<number>,
): TeamStepStatus;

export interface AnswerSummaryItem {
  questionId: number;
  label: string;      // 平文化・12文字で省略済み
  fullLabel: string;  // 平文化のみ（title 用）
  value: number | null;
  max: number | null; // rating は maxScore ?? 5、number は maxScore
}
export interface TeamAnswerSummary {
  teamId: number;
  teamName: string;
  items: AnswerSummaryItem[]; // rating / number のみ、sortOrder 順
}
/** 完了画面用。teams の順に 1 チーム 1 件（回答がないチームも items の value を null で返す） */
export function buildAnswerSummary(
  teams: Pick<Team, 'id' | 'name'>[],
  questions: PublicQuestion[],
  answersByTeam: Record<number, Answers>,
): TeamAnswerSummary[];
```

- `src/shared/` のファイルは client と worker の両方の型チェックに入るので、DOM・React・`window`・`localStorage` を使ってはいけない（worker 側は `lib: ["ES2022"]` で DOM の型がなく、`npm run check` が落ちる）。
- 文言そのもの（「保存して完了」など）は `evalFlow.ts` に置かず、`FormFlow.tsx` で `SubmitMode` → 文言の対応表として持つ（UI 文言は画面側に置く）。
- 値の表示整形（`formatScore`、`src/client/lib/format.ts`）はコンポーネント側で行う。`buildAnswerSummary` は数値のまま返す（shared から client を読み込まない）。
- `buildAnswerSummary` は `typeof value === 'number'` のときだけ値として扱い、それ以外（型の食い違い・未回答）は `null`。

### `FormFlow` の state と遷移（変更点のみ）

- 追加: `drafts: Record<number, AnswerMap>`。
  - `TeamEvaluationStep` の `initialAnswers` は `drafts[team.id] ?? answersByTeam[team.id] ?? {}`。
  - `onAnswersChange` で `drafts[team.id]` を更新。`TeamEvaluationStep` 側は `setAnswers` の更新関数の中で親の setter を呼ばず、次の値を計算してから `setAnswers(next)` と `onAnswersChange?.(next)` を順に呼ぶ。
  - 保存成功時に `drafts[team.id]` を削除。`handleResetRespondent` で `{}` に戻す。
- `handleSubmitTeam`: 遷移先を `findNextTeamIndex(targetTeams, updatedCompleted, currentIndex)` に（`-1` なら完了画面）。
- 初回読み込みの再開位置: 現状の `findIndex` のままでよい（`findNextTeamIndex(..., -1)` と同値。どちらで書いてもよい）。
- 追加: `handleJumpTeam(index)` → `setCurrentIndex(index)`（`phase` は `evaluating` のまま）。
- 追加: `useEffect(() => window.scrollTo(0, 0), [phase, currentIndex])`（`phase` が `evaluating` / `done` のときのみ）。
- `TeamEvaluationStep` の `key={team.id}` は維持する（チームごとに入力 state を作り直す現状の仕組みを変えない。入力の保持は `drafts` で行う）。

## 受け入れ条件

実装者は各項目を満たしたらチェックし、レビュアーは同じ項目を画面とコードで照合する。

### 範囲・構成

- [ ] `src/client/pages/public/QuestionField.tsx` の差分が 0 行
- [ ] `styles.css` の差分が「ファイル末尾への追加のみ」（`git diff` で既存行の変更・削除がない）。`.rating-` を含む行を追加・変更していない
- [ ] `src/shared/types.ts`、`migrations/`、`tsconfig*.json`、`vitest.config.ts` の差分が 0 行
- [ ] `src/worker/` の差分は `src/worker/logic/csv.ts` の `stripMarkdown` を再エクスポート（`export { stripMarkdown } from '../../shared/plainText';`）に置き換える分だけ
- [ ] `src/shared/plainText.ts` の `stripMarkdown` の中身が、移動前の `csv.ts` のものと同一（正規表現・順序とも変えていない）
- [ ] `src/worker/sheets.ts`・`src/worker/routes/admin.ts`・`tests/csv.test.ts` の差分が 0 行で、`tests/csv.test.ts` がそのまま通る
- [ ] `src/shared/evalFlow.ts` と `src/shared/plainText.ts` が DOM・React・`window`・`localStorage` を使っていない
- [ ] `PublicFormPage.tsx` と `PreviewPage.tsx` の差分が 0 行、`FormFlowProps` が変わっていない
- [ ] `ResponsesPanel.tsx` の差分は `stripMarkdown` の削除と import の追加だけ
- [ ] 画面に出す新しい文言はすべて日本語で、この設計書の文言と一致する

### ステップ表示

- [ ] 評価対象が 2 チーム以上のとき、評価画面のヘッダーとカードの間にチップ列が出る。1 チームのときは出ない
- [ ] チップの並びが `sortOrder` 順で、相互評価フォームでは自チームが含まれない
- [ ] 評価中のチップだけに `aria-current="step"` が付く
- [ ] 済み（保存済み）のチップに ✓ が付き、`aria-label` が「<チーム名>、評価済み」
- [ ] 未回答のチップの `aria-label` が「<チーム名>、未回答」、評価中は「<チーム名>、評価中」
- [ ] 済みのチームを開き直したとき、そのチップは「評価中」の見た目・読み上げになる
- [ ] 「評価済み N / M」の N が保存したチーム数に合わせて増える（相互評価の自チームの回答は数えない）
- [ ] 未回答の先のチームのチップを押すとそのチームが開く
- [ ] 保存中はチップが押せない
- [ ] 2 番目を飛ばして 3 番目を開き保存すると、4 番目（未回答なら）に進む。最後まで行ったら飛ばした 2 番目に戻る。全部済みなら完了画面
- [ ] 先頭から順に保存していく従来の使い方で、進む順番が変更前と同じ
- [ ] 入力途中でチップ（または「前のチームへ」）で別チームに移り、戻ると入力が残っている
- [ ] 「別の名前で回答する」で名前を変えると、前の人の入力途中の内容は残らない
- [ ] 15 チーム・幅 375px で、チップ列は 1 行のまま横スクロールでき、画面全体に横スクロールが出ない
- [ ] チームが切り替わると、評価中のチップがチップ列の中で見える位置にある（画面全体が縦に動かない）
- [ ] 保存して次のチームに進んだとき、画面が一番上から表示される
- [ ] 長いチーム名はチップ内で「…」に省略され、`title` で全名が見える
- [ ] 「3 / 5 チーム目」の表示が変更前と同じ位置・同じ文字列で出ている

### 名前表示

- [ ] 評価画面のヘッダーに「<名前> さんとして回答中」が出て、その横（狭い画面では下）に「別の名前で回答する」がある
- [ ] 名前は選んだ回答者の名前と一致する（リロードで復元された場合も）

### ボタン文言

- [ ] 未回答が 2 チーム以上残っているときは「このチームの評価を保存して次へ」
- [ ] 未回答が今のチームだけのときは「保存して完了」で、押すと完了画面に行く
- [ ] 最後のチームを先に開いた場合（他に未回答あり）は「このチームの評価を保存して次へ」で、「保存して完了」にならない
- [ ] 後ろのチームが保存済みの状態でリロードし、途中のチームが最後の未回答のときは「保存して完了」
- [ ] 済みのチームを開き、他に未回答があるときは「修正を保存して次へ」
- [ ] 完了画面から「修正する」で開いたときは「修正を保存して完了画面へ」で、押すと完了画面に戻る
- [ ] 保存中はどの場合も「保存中…」
- [ ] 送信ボタンに `aria-label` が付いていない

### エラー時スクロール

- [ ] 必須項目を空のまま保存を押すと、一番上の未入力項目が画面の縦中央付近までスクロールされる
- [ ] その項目の最初の入力部品にフォーカスが当たる（値は変わらない）
- [ ] プレビュー画面でも同じ動きで、項目が上部の黄色いバナーに隠れない
- [ ] 数値の範囲外（上限超え）でも同じくその項目までスクロールする
- [ ] 「未入力の必須項目があります。…」の要素に `role="alert"` が付いている
- [ ] OS の「視差効果を減らす」設定がオンのときは、なめらかスクロールせず即座に移動する
- [ ] 通信エラーで保存に失敗したときはスクロールしない
- [ ] 各質問の見た目（区切り線、最後の質問の下線なし）が変更前と同じ

### 完了画面

- [ ] 「<名前> さんの回答」が出る
- [ ] 評価対象チームが `sortOrder` 順に 1 行ずつ並び、各行に「修正する」がある
- [ ] 各行に rating と number の質問だけが「ラベル 値/上限」で並ぶ。choice・checkbox・text・textarea は出ない
- [ ] 上限なしの number は「/上限」が付かない
- [ ] 任意項目を空で保存した質問は「—」
- [ ] 質問ラベルの `**` や `#` などの記号が出ない。長いラベルは 12 文字＋「…」で、`title` に全文
- [ ] 管理画面「回答」タブの質問見出しが shared 版 `stripMarkdown` で平文化される（例: `技術-力` が `技術-力` のまま出る。`技術 力` にならない）
- [ ] rating / number の質問がないフォームでは、チーム名と「修正する」だけが並ぶ
- [ ] 合計・平均・重みに関する表示がない
- [ ] 「修正する」の `aria-label` が「<チーム名>の回答を修正する」
- [ ] 「修正する」で開いて値を変えて保存すると、完了画面の値が変わっている
- [ ] 本番画面ではリロード後も同じ値が出る（サーバーの保存済み回答から出ている）
- [ ] プレビュー画面でも入力した値でサマリーが出る

### 品質

- [ ] `npm run format:check` / `npm run check` / `npm test` / `npm run build` が通る
- [ ] `tests/evalFlow.test.ts` が追加され、テスト計画の項目を網羅している
- [ ] UI を変えたので PR にスクリーンショット（評価画面・エラー時・完了画面、スマホ幅）を貼る。回答者の実名は写さない（ダミー名を使う）

## テスト計画

### 自動テスト（vitest の単体テスト）

フロントのテスト基盤（React の描画テスト）は入れない。画面から切り離せる判定と整形を `src/shared/evalFlow.ts` の純関数にし、`tests/evalFlow.test.ts` で試す。

**設定の確認結果**（このブランチで確認済み）:

- `vitest.config.ts` の `include` は `['tests/**/*.test.ts']`。**テストは既存の約束どおり `tests/` 直下に置く**ので vitest の設定変更は不要。`tests/evalFlow.test.ts` から `../src/shared/evalFlow` を import すれば実行される。
- `npm run check`（`tsc -b`）について: `tests/` を型チェックする `tsconfig.worker.json` の `include` は `["src/worker", "src/shared", "tests"]`、`tsconfig.client.json` は `["src/client", "src/shared"]` で、**`src/shared` は両方に既に入っている**。そのため `src/shared/` に置いたファイルは設定を変えずに client・worker・`tests/` から読み込める（既存の `tests/aggregate.test.ts` などが `../src/shared/types` を読み込んでいるのと同じ）。`tsconfig*.json` は変更しない。
  - 参考: 当初案の `src/client/lib/` に置くと、`tests/` から読み込んだ時点で TS6307（プロジェクトのファイル一覧にない）で `tsc -b` が落ちることを一時コピーで確認している。`src/shared/` に置くのはこれを避ける意味もある。
  - `src/shared/` のファイルは worker 側（`lib: ["ES2022"]`、DOM なし）でも型チェックされるので、DOM・React・`window` を使ってはいけない。`formatScore` を使う整形はコンポーネント側で行い、`evalFlow.ts` からは import しない。
- `stripMarkdown` の移動後も、`tests/csv.test.ts` は `../src/worker/logic/csv` の再エクスポート経由で同じ関数をテストし続ける（テストの変更不要）。

**テストケース**:

- `findNextTeamIndex`
  - 先頭から順に済みの場合、今の次の未回答を返す
  - 今より後ろに未回答がなく前にある場合、前の未回答を返す（折り返し）
  - 全部済みなら -1
  - `fromIndex = -1` で最初の未回答を返す（再開位置）
  - `completed` に `teams` にない ID が入っていても影響しない
- `getSubmitMode`
  - 未回答 2 以上 → `next`
  - 未回答が今のチームだけ → `finish`
  - 今のチームが最後の位置でも、他に未回答があれば `next`
  - 今のチームが途中の位置でも、他が全部済みなら `finish`
  - 今のチームが済み・他に未回答あり → `edit-next`
  - 今のチームが済み・他も全部済み → `edit-finish`
  - `completed` に `teams` 外の ID（相互評価の自チーム）があっても結果が変わらない
- `getTeamStepStatus`
  - 評価中が済みより優先される／済み／未回答
- `buildAnswerSummary`
  - rating と number だけが `sortOrder` 順に並ぶ（`view.questions` の並びが崩れていても）
  - 未回答・文字列など数値でない値は `null`
  - rating の `max` は `maxScore ?? 5`、number は `maxScore`（`null` のまま）
  - ラベルの Markdown 記号が除かれる、12 文字超は「…」付きで省略され `fullLabel` は全文
  - ラベルが空になると「質問N」（N は rating/number に限らない全質問の中での並び順）
  - 回答が 1 件もないチームも行が出て、値がすべて `null`
- `stripMarkdown`（`src/shared/plainText.ts`）は中身を変えずに移すだけで、既存の `tests/csv.test.ts` が再エクスポート経由でそのまま確かめる。新しいテストは足さない（`buildAnswerSummary` のラベルのケースでも間接的に通る）。

### 画面の確認

自動テストでは画面の動き（スクロール、フォーカス、チップ列の見た目）は確かめられないため、次の「手動確認手順」で確認する。

## 手動確認手順

### 準備

```bash
npm ci
npm run db:migrate:local
npm run dev   # http://localhost:5173
```

1. `http://localhost:5173/admin` を開き、`.dev.vars` の `ADMIN_TOKEN`（例 `dev-admin-token`）でログイン。
2. イベントを作り、次を登録する（名前はダミー）:
   - チーム 15 個（「チーム01」〜「チーム15」。1 つは「とても長いチーム名のテスト用チームです」にする）
   - 審査員 2 人（「審査員A」「審査員B」）
   - メンバー 3 人（それぞれ別のチームに所属）
3. 審査員用フォームを作り、質問を次の順で入れて公開する:
   1. rating・上限 5・必須・ラベル `**技術力**`
   2. text・必須・ラベル「コメント」
   3. rating・上限 5・必須・ラベル `発表のわかりやすさ（スライド・話し方）`（12 文字超）
   4. number・上限 10・任意・ラベル「加点」
   5. number・上限なし・任意・ラベル「おまけ」
   6. choice・任意
4. 相互評価用フォームも 1 つ作り、rating の質問を 1 つ入れて公開する。
5. ブラウザの開発者ツールで幅 375px（iPhone 相当）にする。

### 本番画面（`/f/<URL名>`）

1. 審査員用フォームを開き「審査員A」を選ぶ → ヘッダーに「**審査員A** さんとして回答中」と「別の名前で回答する」。チップ列が 1 行で出て、「チーム01」が評価中、「評価済み 0 / 15」。
2. 何も入力せず保存 → 「技術力」が画面中央にスクロールされ、「1」のボタンにフォーカス。上部の赤いメッセージが出る。
3. 質問を上から少しスクロールした状態で「発表のわかりやすさ」だけ未入力にして保存 → その項目にスクロール。
4. 「加点」に 11 を入れて保存 → 「加点」にスクロールし「0〜10点で入力してください」。
5. 正しく入力して保存 → 「チーム02」が画面の一番上から表示され、チップ「チーム01」に ✓、「評価済み 1 / 15」。ボタンは「このチームの評価を保存して次へ」。
6. 「チーム02」で技術力だけ入力し、チップ「チーム05」を押す → 「チーム05」が開く。チップ列の中で「チーム05」が見えている。画面全体が横にスクロールしない。
7. 「チーム05」を保存 → 「チーム06」に進む（「チーム02」に引き戻されない）。
8. チップ「チーム02」を押す → 手順 6 で入力した技術力が残っている。
9. チップ列を横スクロールして長い名前のチームが「…」で省略されていることを確認。
10. 「チーム01」のチップを押す → ボタンが「修正を保存して次へ」。保存 → 次の未回答（「チーム02」など）へ。
11. 残りを保存していき、未回答が 1 チームになったとき → ボタンが「保存して完了」。途中で「チーム15」（最後の位置）を未回答が他に残っている状態で開いたとき、「保存して完了」になっていないことも確認。
12. 「保存して完了」を押す → 完了画面。「**審査員A** さんの回答」、15 行のサマリー。各行「技術力 4/5　発表のわかりやすさ… 3/5　加点 2/10　おまけ 7」のように並び、コメント・選択肢は出ない。任意で空にした質問は「—」。長いラベルにマウスを乗せると全文が出る。
13. 「チーム03」の「修正する」 → ボタンが「修正を保存して完了画面へ」。値を変えて保存 → 完了画面に戻り、値が変わっている。
14. ページをリロード → 完了画面が同じ値で出る。
15. 途中状態の確認: 「別の名前で回答する」→「審査員B」で数チーム保存 → リロード → 再開位置のチームに名前が出ている。後ろのチームだけ保存済みの状態を作ってリロードし、途中のチームが最後の未回答のとき「保存して完了」になることを確認。
16. 相互評価フォームをメンバーで開く → チップ列に自分のチームがない。「評価済み N / M」の M が「チーム数 − 1」。
17. キーボードだけで操作: Tab でチップに移動して Enter で開ける。フォーカスの輪郭が見える。
18. macOS の「視差効果を減らす」（または開発者ツールの `prefers-reduced-motion: reduce` エミュレーション）をオンにして手順 2 → なめらかに動かず即座に移動する。
19. 通信エラー: 開発者ツールで「オフライン」にして保存 → 赤いメッセージは出るが、スクロールしない。

### プレビュー画面（`/admin/forms/<id>/preview`）

1. エディタの「プレビュー」から開く。上部に黄色いバナー。
2. 本番の手順 1〜13 と同じことを行い、同じ表示・同じ動きになることを確認する。特に:
   - 手順 2 で、スクロールした項目が黄色いバナーの下に隠れない。
   - 完了画面のサマリーに、プレビュー中に入力した値が出る（DB には保存されない）。
3. 「エディタに戻る」→ 再度プレビュー → まっさらな状態から始まる（現状どおり）。

### 管理画面・CSV（stripMarkdown 統合の確認）

1. 質問ラベルに `技術-力` と `[資料](https://example.com) の出来` を持つ質問を用意して回答を 1 件以上入れ、フォームの「回答」タブ（`ResponsesPanel`）を開く → 見出しが「技術-力」「資料 の出来」と出る（変更前の簡易版では「技術 力」「資料 https://example.com の出来」のように崩れていた）。
2. 同じフォームの CSV を書き出し → 見出し行が変更前と同じ（worker 側は同じ関数を再エクスポートで使うため変わらない）。

## 差分見積もり

目安は差分 400 行以内（CONTRIBUTING）。この設計書自体は数えない。Prettier 整形後の追加＋削除行の見込み:

| ファイル | 見込み |
|---|---|
| `src/shared/evalFlow.ts` | 約 75 |
| `src/shared/plainText.ts` | 約 15（`csv.ts` から移動） |
| `src/worker/logic/csv.ts` | 約 15（本体削除・再エクスポート 1 行） |
| `ResponsesPanel.tsx` | 約 9（削除 7・追加 1〜2） |
| `TeamStepNav.tsx` | 約 60 |
| `FormFlow.tsx` | 約 50 |
| `TeamEvaluationStep.tsx` | 約 35 |
| `CompletionStep.tsx` | 約 50 |
| `styles.css`（末尾追加） | 約 110 |
| **本体小計** | **約 420** |
| `tests/evalFlow.test.ts` | 約 110 |
| **合計** | **約 530** |

目安の 400 行を超える見込みだが、**今回は削らない**（完了サマリーも切り出さずこの PR に含める）。PR 本文に目安超過の理由として次を明記する:

- 提案 3〜7 はどれも `FormFlow` の state（`completedTeamIds`・`answersByTeam`・`currentIndex`・`drafts`）を共有しており、分割すると後の PR が前の PR の上に乗る形（PR を積む形。CONTRIBUTING で避けるとされている）になる。
- 合計のうち約 110 行はテスト（`tests/evalFlow.test.ts`）。
- `stripMarkdown` の移動（`csv.ts` → `src/shared/plainText.ts`）は中身を変えない移動で、行数の割にレビュー負担は小さい。

`drafts`（入力途中の保持）と保存後の遷移先の変更（`findNextTeamIndex`）はジャンプを許すことの安全装置なので、どの場合も削らない。

## `feat/rating-scale-labels` との衝突について

- この PR は `QuestionField.tsx` と `.rating-*` を触らないので、中身の衝突は起きない。
- `styles.css`: `feat/rating-scale-labels` は既存の rating セクションと既存の `@media (min-width: 640px)` ブロックに追記し、ファイル末尾には追記しないことで合意済み。この PR は**ファイル末尾への追記のみ**で既存行を変えないので、同じ場所を触らず衝突しない。
- `src/shared/`: この PR は `evalFlow.ts` と `plainText.ts`、`feat/rating-scale-labels` は `scaleLabels.ts` と、互いに別ファイルを追加する。
- `src/shared/types.ts`（質問にアンカーラベルを足す場合）は `feat/rating-scale-labels` 側だけが変更する。この PR の `buildAnswerSummary` は `PublicQuestion` の既存フィールド（`id` / `type` / `labelMd` / `maxScore` / `sortOrder`）しか使わないので、フィールドが増えても影響しない。
