# 回答者ごとの傾向と標準化平均・質問ごとの分布 設計書

日付: 2026-09-23
ステータス: 承認済み（承認日 2026-09-23）
ブランチ: `feat/judge-calibration`（origin/main から分岐）
出典: [Googleフォーム UI 調査](../../research/2026-09-23-google-forms-ux-research.md) の「5. formnow への具体的提案」8・9

## 目的

- 主催者が「回答」タブで、**回答者（審査員・メンバー）ごとの甘い・辛いの癖**を一目で見られるようにする
- 癖をならした **標準化平均** と **標準化順位** を、今の平均・順位の横に併記する（今の平均・順位は主表示のまま変えない）
- 計算式から標準化平均を使えるように、変数 `<slug>_zavg` を足す
- 質問ごとに「どの点が何件付いたか」を小さな横棒で見られるようにする（全員が 5 を付けて差が出ていない質問に気づける）

## 背景

- 審査員には甘辛の癖がある。全員が全チームを採点すれば平均で相殺されるが、一部のチームしか採点しない場合は、回答者ごとに平均 0・ばらつき 1 にそろえる標準化（z スコア）が必要（HeroX、Entropy 2025。調査レポート 3.3 節）
- formnow の相互評価は自チームをスキップするため、**チームごとに採点した人の集まりが違う**。素の平均だと、甘い人に多く採点されたチームが有利になる
- 今の「回答」タブ（`ResponsesPanel.tsx`）はチーム別ランキングと質問別平均だけで、回答者側の傾向も、点数の散らばり方も見えない

## PR の分け方（設計判断）

差分見積もり（後述）で 8 と 9 を合わせると約 600 行になり、CONTRIBUTING の目安 400 行を大きく超える。2 つは計算も画面も独立しているので、**この仕様書は両方を定義し、実装は 2 本の PR に分ける**。

| PR | ブランチ | 範囲 | 見積もり |
|---|---|---|---|
| PR-A（この PR） | `feat/judge-calibration` | 8: 回答者ごとの傾向・標準化平均／順位・計算式の `<slug>_zavg`・Sheets「集計」タブの列追加 | 約 390 行 |
| PR-B（次の PR） | `feat/question-distribution` | 9: 質問ごとの分布 | 約 200 行 |

PR-B は PR-A がマージされてから `main` に対して出す（CONTRIBUTING「PR は積まない」）。両方とも `FormSummary` と `ResponsesPanel.tsx` に足すため、並行させると同じ箇所でぶつかる。

`<slug>_zavg` は PR-A に含める。`formula.ts` は変数を動的に受け取る作りで**変更不要**、増えるのは `services.ts` の 3 行と説明文 3 か所だけなので、別 PR にする理由がない。

## 範囲外

- 標準化平均を主表示にする切り替え（並び順は今の平均・順位のまま）
- 質問ごとの標準化（標準化は回答 1 件のスコア＝重み付き合計に対してだけ行う）
- フォームをまたいだ標準化（標準化はフォーム単位。審査員フォームと相互評価フォームは別々に計算）
- 「何件以上答えた人だけ標準化に使う」などのしきい値設定（固定で 2 件以上）
- 未回答の回答者の一覧・回答進捗（回答者ごとの傾向の表は、1 件以上回答した人だけを出す）
- 外れ値の自動検出、「甘め／辛め」の自動判定ラベル（数値を出すだけ）
- 分布のチーム別表示、checkbox 質問の分布、上限のない number 質問の分布、PR #16 の段階ラベル（`scaleLabels`）を分布の見出しに使うこと
- CSV エクスポート（回答 1 件 1 行の出力で、集計は含まないので変更なし）、Sheets への分布の出力

## 計算の定義

### 用語

- フォーム F の回答 r のスコア `s_r` = 既存の `responseScore(questions, answers)`（Σ 数値化した値 × 重み）。今のチーム平均と同じ土台を使う
- 回答者 j の回答の集合 `R_j`、件数 `n_j = |R_j|`（= 回答したチーム数。回答は「回答者 × チーム」で 1 件なので一致する）

### 回答者ごとの傾向（`computeRespondentSummaries`）

- 平均 `m_j = Σ s_r / n_j`
- ばらつき（標準偏差）`σ_j = sqrt( Σ (s_r − m_j)² / n_j )` … **母標準偏差**（n で割る）
  - 理由 1: ここで知りたいのは「この人が実際に付けた点の散らばり」そのもので、背後の母集団を推定したいわけではない
  - 理由 2: 母標準偏差で割ると、変換後の z の分散がちょうど 1 になる。「ばらつきを 1 にそろえる」という説明と数値が一致する
  - 理由 3: 相互評価では 1 人 2〜4 件が普通。標本標準偏差（n−1 で割る）だと件数が少ない人ほど σ が大きく出て z が縮み、人によって「1」の意味が変わる
- `n_j = 1` のとき `sd = null`（1 件ではばらつきを語れない。画面は「-」）
- `n_j ≥ 2` で全部同じ点なら `sd = 0`
- 全体との差 `avgDiff_j = m_j − M`、`M` = そのフォームの全回答のスコアの平均（回答 1 件を 1 票として数える）。プラスなら甘め、マイナスなら辛め
- 標準化に使うか `standardized_j = (n_j ≥ 2 かつ σ_j > 1e-9)`（浮動小数の誤差で 0 にならないケースを 0 扱いにする）
- 並び順は回答者名簿の順（`sort_order, id`）。1 件も回答していない人は含めない

### 標準化平均（`computeStandardizedTeamAverages`）

- `standardized_j` が真の回答者 j の各回答 r を `z_r = (s_r − m_j) / σ_j` に変換する
- チーム t の標準化平均 `zAvg_t` = チーム t への回答のうち、z を持つもの（= 標準化に使う回答者の回答）の z の平均。1 件もなければ `null`
- 標準化順位 `zRank_t` = `zAvg_t` の降順。既存の `computeRanks` を使い、同点は同順位（1,1,3 方式）、`null` は順位なし
  - z は割り算を含むので、数学的に同じ値が浮動小数で 1e-16 ずれることがある。**順位付けにだけ** `Math.round(zAvg * 1e9) / 1e9` を使う（API が返す `zAvg` は丸めない）

**回答 1 件の人・全部同じ点の人は「除外」する（z = 0 にしない）。** 理由:

1. その人の点からは「このチームは他より上か下か」が一切読み取れない。1 件だけなら比べる相手がなく、全部同じ点なら差を付けていない。情報がないものを 0（＝ちょうど平均）とみなすのは、既存の「回答 0 件は 0 点ではない」（`docs/superpowers/specs/2026-09-07-formnow-design.md`「計算・集計」3）と同じ理由で誤り
2. 0 を混ぜると、そういう人に多く採点されたチームほど標準化平均が 0 に引き寄せられる。「採点者の集まりの違いで有利不利が出る」のを直すための機能が、別の形で同じ偏りを持ち込む（手計算例 2 を参照）
3. 除外しても、その人の回答は**今の平均・順位にはそのまま入る**。消えるのは標準化平均への寄与だけで、表でも「標準化: 使わない（回答が 1 件）」と理由を出す

注意（仕様として受け入れる）: 全員が全チームを採点している場合でも、標準化順位は今の順位と一致するとは限らない。点差を大きく付ける人の影響が相対的に小さくなるため。だから置き換えではなく併記にする。

### 手計算例 1（順位が入れ替わる例）

チーム A・B・C、質問は rating 1 問・重み 1（スコア = 点数）。各回答者は 2 チームだけ採点する。

| 回答者 | A | B | C | 平均 m | σ | z |
|---|---|---|---|---|---|---|
| P（甘め） | 9 | – | 7 | 8 | 1 | A +1, C −1 |
| Q（辛め） | – | 5 | 3 | 4 | 1 | B +1, C −1 |
| R | 6 | 8 | – | 7 | 1 | A −1, B +1 |

| チーム | 平均 | 順位 | 標準化平均 | 標準化順位 |
|---|---|---|---|---|
| A | (9+6)/2 = 7.5 | 1 | (+1 −1)/2 = 0 | 2 |
| B | (5+8)/2 = 6.5 | 2 | (+1 +1)/2 = 1 | 1 |
| C | (7+3)/2 = 5 | 3 | (−1 −1)/2 = −1 | 3 |

B は採点した 2 人の両方から「自分の中で上のほう」と評価されたが、辛い Q が採点したため素の平均では A に負ける。A は甘い P のおかげで平均が高い。

全体平均 M = (9+7+5+3+6+8)/6 = 38/6 ≈ 6.333。全体との差は P +1.667、Q −2.333、R +0.667。

### 手計算例 2（除外の効果）

例 1 に 2 人を足す。S は A=5, B=5（全部同じ点）、T は C=10 だけ（回答 1 件）。

- 回答者ごとの傾向: S は件数 2・平均 5・ばらつき 0・標準化に使わない、T は件数 1・平均 10・ばらつき「-」・標準化に使わない
- 全体平均 M = (38 + 5 + 5 + 10)/9 = 58/9 ≈ 6.444。差は P +1.556、Q −2.444、R +0.556、S −1.444、T +3.556
- 今の平均: A = (9+6+5)/3 ≈ 6.667、B = (5+8+5)/3 = 6、C = (7+3+10)/3 ≈ 6.667 → 順位 A 1、C 1、B 3（T の 1 件の 10 点で C が浮上）
- 標準化平均: S と T を除外するので**例 1 と同じ** A 0 / B 1 / C −1、順位 B 1 / A 2 / C 3
- 仮に除外せず z = 0 にすると A = (1−1+0)/3 = 0、B = (1+1+0)/3 ≈ 0.667、C = (−1−1+0)/3 ≈ −0.667 となり、S・T に採点された分だけ B と C が 0 に引き寄せられる（理由 2）

### 手計算例 3（標準化平均がないチーム）

チーム D は T（回答 1 件）だけが採点 → D の平均 10・順位あり、標準化平均 `null`・標準化順位 `null`（画面は「-」）。回答 0 件のチームも `null`。

### 結合テスト用の seed での値（`tests/helpers/fixture.ts`）

既存の「集計」describe の回答（審査員フォーム、スコア = 技術力×2 + デザイン）:

| 回答者 | A班 | B班 | 平均 | σ | 標準化 |
|---|---|---|---|---|---|
| 審査員1 | 23 | 23 | 23 | 0 | 使わない（全部同じ点） |
| 審査員2 | 22 | 29 | 25.5 | 3.5 | 使う（A −1, B +1） |

- 全体平均 = 97/4 = 24.25、差は審査員1 −1.25、審査員2 +1.25
- 標準化平均: B班 1（順位 1）、A班 −1（順位 2）、C班 null（順位 null）
- 相互評価フォームはメンバー A・B とも回答 1 件なので、全チーム標準化平均 null

### 計算式の変数 `<slug>_zavg`

- `computeFormulaResults` でチームごとに `vars[`${slug}_zavg`] = zAvg` を登録。**`zAvg` が null のときは登録しない**（既存の `_avg` と同じ。式が参照すると「不明な変数」になり、そのチームの結果だけ null、式全体のエラーにはしない）
- slug は `/^[a-z0-9-]+$/`（`admin.ts` / `tools.ts` の `SLUG_RE`）でアンダースコアを含まないので、`<slug>_zavg` が別フォームの `<slug>_avg` 等と同じ名前になることはない
- `formula.ts` は変更しない（既知変数の最長一致で `judge_zavg` を 1 トークンとして切り出せる）

### 質問ごとの分布（PR-B、`computeQuestionDistributions`）

フォーム全体（全チーム・全回答者の合算）で出す。チーム別は出さない。理由: 目的は「その質問で差が付いているか」という**質問の性質**を見ることで、チーム別の比較は既存の質問別平均の列で足りる。チーム別にすると表示量がチーム数倍になり 400 行に収まらない。

| 質問の型 | 出す条件 | 区分（上から順） |
|---|---|---|
| rating | 上限 `max = maxScore ?? 5`（回答画面 `QuestionField.tsx` と同じ既定値）が 1〜20 の整数 | 1, 2, …, max |
| number | `maxScore` が 1〜20 の整数 | 0, 1, …, maxScore（number は 0 を許すため） |
| choice | 選択肢が 1 つ以上 | 選択肢の並び順のラベル |
| checkbox / text / textarea | 出さない | – |

- 各回答の値を区分に数える。**どの区分にも当てはまらない値は `otherCount`**（rating の 0 や小数、選択肢から消えたラベルなど。API・MCP 経由や質問の編集で起こりうる）
- 回答していない（その質問の answer がない）ものと choice の空文字 `''`（任意質問の未選択）は数えない
- 配列はフォームの質問の `sortOrder` 順

手計算例: rating（max 3）への値 3, 3, 1, 0 → 区分 1:1件, 2:0件, 3:2件, その他 1件。choice（ぜひ／まあ／うーん）への値 ぜひ, ぜひ, 消えた選択肢, '' → ぜひ 2, まあ 0, うーん 0, その他 1（'' は数えない）。number（maxScore null）→ 配列に含めない。

## API の形（`src/shared/types.ts` の差分）

変更は「集計」節（`TeamSummary` / `FormSummary`、現 118〜133 行付近）だけ。`Question` 型には触れない（PR #16 と衝突するため）。

```ts
/** チーム別集計（フォーム単位） GET /api/admin/forms/:id/summary */
export interface TeamSummary {
  teamId: number;
  teamName: string;
  count: number;
  sum: number;
  avg: number | null;
  rank: number | null;
  /** 質問ID→平均スコア（採点対象の質問のみ） */
  questionAvgs: Record<number, number>;
+ /**
+  * 標準化平均: 回答者ごとに自分のスコアを平均0・ばらつき1にそろえた値の、このチームでの平均。
+  * 回答1件だけ・全部同じ点の回答者の回答は使わない。使える回答がなければ null
+  */
+ zAvg: number | null;
+ /** zAvg の降順の順位（同点は同順位）。zAvg が null なら null */
+ zRank: number | null;
}

+/** 回答者ごとの傾向（フォーム単位）。1件以上回答した回答者だけ、名簿順 */
+export interface RespondentSummary {
+  respondentId: number;
+  respondentName: string;
+  /** 回答したチーム数 */
+  count: number;
+  /** この回答者が付けたスコア（回答1件のスコア）の平均 */
+  avg: number;
+  /** avg − フォームの全回答のスコア平均。プラスなら甘め */
+  avgDiff: number;
+  /** スコアの母標準偏差。count が 1 なら null */
+  sd: number | null;
+  /** 標準化平均の計算に使ったか（count ≥ 2 かつ sd > 0） */
+  standardized: boolean;
+}

+/** 質問ごとの分布（フォーム全体）。PR-B で追加 */
+export interface QuestionDistribution {
+  questionId: number;
+  /** 表示順の区分。rating は 1..上限、number は 0..上限、choice は選択肢の順 */
+  buckets: { label: string; count: number }[];
+  /** どの区分にも当てはまらない回答の件数（消えた選択肢、範囲外や小数の値） */
+  otherCount: number;
+}

export interface FormSummary {
  formId: number;
  formSlug: string;
  maxPossibleScore: number;
  teams: TeamSummary[];
+ respondents: RespondentSummary[];
+ /** rating・上限のある number・choice の質問だけ、質問の並び順（PR-B で追加） */
+ questionDistributions: QuestionDistribution[];
}
```

- `teams` の並び順は今までどおり**今の順位**（`rank` 昇順、null は末尾）。`zRank` では並べ替えない
- 数値は丸めずに返す（表示側で `formatScore` の小数 2 桁）
- MCP `get_team_summary` は `computeFormSummary` の結果をそのまま返すので、新しいフィールドは自動で含まれる。説明文だけ更新する
- `FormulaResults` の型は変えない（変数が増えるだけ）

## サーバー側の実装

### `src/worker/logic/aggregate.ts`（純関数）

```ts
/** 回答者IDつきの回答。標準化・回答者別集計の入力 */
export interface ScoredResponseInput extends AggregateResponseInput {
  respondentId: number;
}

/** zAvg / zRank を付ける前のチーム別集計 */
export type BaseTeamSummary = Omit<TeamSummary, 'zAvg' | 'zRank'>;

// 既存。戻り値の型だけ BaseTeamSummary[] に変える（中身は変えない）
export function aggregateTeamSummaries(...): BaseTeamSummary[];

export function computeRespondentSummaries(
  responses: ScoredResponseInput[],
  questions: Question[],
  respondents: Pick<Respondent, 'id' | 'name'>[], // 名簿順で渡す
): RespondentSummary[];

export function computeStandardizedTeamAverages(
  responses: ScoredResponseInput[],
  questions: Question[],
  teams: Pick<Team, 'id'>[],
): Map<number, { zAvg: number | null; zRank: number | null }>;

/** BaseTeamSummary に zAvg / zRank を付ける（並び順は変えない） */
export function withStandardized(
  teams: BaseTeamSummary[],
  z: Map<number, { zAvg: number | null; zRank: number | null }>,
): TeamSummary[];

// PR-B
export function computeQuestionDistributions(
  responses: AggregateResponseInput[],
  questions: Question[],
): QuestionDistribution[];
```

- 回答者ごとの `m_j`・`σ_j`・`standardized_j` は内部関数 `respondentStats(responses, questions)` で 1 回だけ計算し、上の 2 関数で共有する
- `AggregateResponseInput` は変えない（既存テストの回答データに respondentId を足さずに済む）
- 名簿にない respondentId の回答は、回答者ごとの傾向の表には出さない（CASCADE があるので実際には起きない）。標準化平均の計算には使う

### `src/worker/db.ts`

`listResponsesForScoring`（現 832〜846 行）の SELECT に `respondent_id` を足し、戻り値に `respondentId` を含める（3 行程度）。PR #16 の db.ts の変更は 60〜700 行台の質問まわりだけなので、離れた場所で衝突しない。

### `src/worker/services.ts`

- `computeFormSummary`: 既存の `Promise.all` に `db.listRespondents(database, form.eventId)` を足し、`teams: withStandardized(aggregateTeamSummaries(...), computeStandardizedTeamAverages(...))`、`respondents: computeRespondentSummaries(...)` を返す（PR-B で `questionDistributions` も）
- `computeFormulaResults`: フォームごとに `computeStandardizedTeamAverages` を呼び、`zAvg !== null` のチームだけ `vars[`${form.slug}_zavg`]` を登録

### `src/worker/sheets.ts`（Sheets「集計」タブ）

- `SummarySheetTeamRow` に `zAvg: number | null; zRank: number | null` を追加、`syncFormToSheet` の `teamRows` の組み立てで詰める
- `buildSummarySheetRows` のヘッダーの**最後**（質問別平均の列の後ろ）に `標準化平均`、`標準化順位` を足す。値が null なら空文字（既存の avg と同じ）
- 最後に足す理由: 既存の列の位置が変わると、利用者がシート側で組んだ参照（例: `集計!D:D`）がずれるため
- 計算式ランキングの部分は変えない（`_zavg` を使った式はそのまま出る）

### 説明文

- `src/worker/mcp/tools.ts`
  - `get_team_summary` の description: 「フォームのチーム別集計 (回答数・平均・合計・順位・質問別平均・標準化平均と標準化順位) と回答者ごとの傾向 (件数・平均・全体との差・ばらつき) を取得する」（PR-B で「質問ごとの分布」を追記）
  - `set_formulas` の expression の describe: 「変数は <form_slug>_avg / _sum / _count / _zavg (標準化平均)」
- `src/client/pages/admin/tabs/FormulasTab.tsx` の hint-text: 「変数: <フォームslug>_avg, _sum, _count, _zavg（標準化平均）。例: …」
- `docs/superpowers/specs/2026-09-07-formnow-design.md`「計算・集計」2・3: 回答者別集計・標準化平均と `_zavg` を 1 行ずつ追記
- `docs/architecture.md`: `aggregate.ts` の説明を「チーム別の平均・順位、回答者ごとの傾向、標準化平均」に

## 画面仕様（管理画面 → フォーム → 「回答」タブ、`ResponsesPanel.tsx`）

### 現状

```
[CSVダウンロード] [シートへ一括同期]

チーム別ランキング
| 順位 | チーム | 回答数 | 平均 | 合計 | 技術力 | デザイン |
満点目安: 30

個別回答
（カードの一覧）
```

### 変更後（PR-A）

```
[CSVダウンロード] [シートへ一括同期]

チーム別ランキング
「標準化平均」は、甘めに付ける人・辛めに付ける人の癖をならした平均です。回答者ごとに自分の平均を 0、
ばらつきを 1 にそろえてからチームごとに平均しています（0 より大きいほど高い評価）。相互評価のように、
チームごとに採点した人が違うときの参考にしてください。
| 順位 | チーム | 回答数 | 平均 | 合計 | 標準化平均 | 標準化順位 | 技術力 | デザイン |
|  1   | B班    |   2    |  26  |  52  |    +1      |     1      |  9.5   |   7      |
|  2   | A班    |   2    | 22.5 |  45  |    -1      |     2      |  7.5   |  7.5     |
|  -   | C班    |   0    |  -   |   0  |     -      |     -      |   -    |   -      |
満点目安: 30

回答者ごとの傾向
「全体との差」がプラスなら甘め、マイナスなら辛めです。「ばらつき」が小さい人は、チーム間で点の差をあまり付けていません。
| 回答者  | 回答したチーム数 | 平均 | 全体との差 | ばらつき | 標準化 |
| 審査員1 |        2         |  23  |   -1.25    |    0     | 使わない（全部同じ点） |
| 審査員2 |        2         | 25.5 |   +1.25    |   3.5    | 使う |

個別回答
（変更なし）
```

- チーム別ランキングの表は、今の列はそのまま。「合計」の後ろに「標準化平均」「標準化順位」を足す。空のときの `colSpan` は 5 → 7
- 標準化平均は符号付きで表示（`+1`、`-0.5`、`0`）。null は「-」
- 説明文は `<p className="muted">`、表の上に置く
- 「回答者ごとの傾向」は `<section>` を 1 つ足し、チーム別ランキングの `<section>` の直後・「個別回答」の前に置く。表は既存の `table-scroll` + `data-table`
  - 「ばらつき」の見出しには `title="標準偏差"` を付ける（本文では専門用語を出さない）
  - 「全体との差」は符号付き。「ばらつき」は `sd` が null なら「-」
  - 「標準化」列: `standardized` が真なら「使う」、偽なら `count === 1` で「使わない（回答が1件）」、それ以外は「使わない（全部同じ点）」。「使わない」は `muted`
  - 回答者 0 人のときは表の代わりに `<p className="muted">まだ回答がありません。</p>`
- 符号付き表示の関数 `formatSigned(n: number | null): string` は **`ResponsesPanel.tsx` の末尾**（既存の `formatAnswerValue` の隣）にローカル関数として置く。`formatScore` を使って 2 桁に丸め、結果が `0` / `-0` なら `0`、正なら `+` を付ける。`lib/format.ts` に置かないのは、import 行を変えると PR #17 と衝突するため（後述）
- 回答者ごとの傾向の表は `FormSummary['respondents'][number]` 型で受ける（`RespondentSummary` を import しないため）

### 変更後（PR-B で追加）

```
質問ごとの分布
┌ 技術力 ──────────────────────────────┐
│  1 ▏                        0件      │
│  …                                   │
│  8 ██████                  1件 (25%) │
│  9 ██████                  1件 (25%) │
│ 10 ██████                  1件 (25%) │
│ その他 ██████              1件 (25%) │ ← otherCount > 0 のときだけ
└──────────────────────────────────────┘
上限のない数値の質問と、複数選択の質問は分布を出しません。
```

- 「回答者ごとの傾向」の後ろ・「個別回答」の前に `<section>` を足す
- 質問 1 つにつき `div.dist-card`（見出しは `questionLabel`）の中に行を並べる。行は `div.dist-row`（ラベル／棒／件数）
- 棒の長さは `count / 合計 × 100%`（合計 = 各区分の合計 + otherCount）。合計が 0 の質問は行の代わりに「回答なし」
- CSS だけで描く（`div.dist-bar` の中の `span` に `style={{ width: '…%' }}`、色は `var(--accent)`、背景は `var(--accent-soft)`）。グラフライブラリは入れない
- `questionDistributions` が空なら section ごと出さない

### CSS（`src/client/styles.css`）

既存の `.data-table thead th { … }`（現 1077 行付近）の直後、`.response-list` の前に追記する。末尾と rating セクション、`@media (min-width: 640px)` ブロックには足さない。

- PR-A: `.table-note`（表の上の説明文の余白。`.muted` と併用）、`.num-signed`（右寄せ・等幅数字 `font-variant-numeric: tabular-nums`）程度で 10 行前後
- PR-B: `.dist-list`, `.dist-card`, `.dist-row`（`display: grid; grid-template-columns: 4.5em 1fr 6.5em; gap: 8px; align-items: center`）, `.dist-bar`, `.dist-bar > span` で 30 行前後。スマホ幅でも 1 行に収まるよう、ラベル列は `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`

## 受け入れ条件

PR-A

- [ ] `GET /api/admin/forms/:id/summary` の `teams[]` に `zAvg` / `zRank`、トップレベルに `respondents` が出る
- [ ] 既存フィールド（`count` / `sum` / `avg` / `rank` / `questionAvgs` / `maxPossibleScore`）の値と `teams` の並び順が変わらない（既存の結合テストがそのまま通る）
- [ ] 回答 1 件の回答者・全部同じ点の回答者は、標準化平均に使われず、表に理由が出る
- [ ] 標準化に使える回答がないチームは標準化平均・標準化順位とも「-」（null）
- [ ] 手計算例 1〜3 と seed の値が単体テスト・結合テストで再現される
- [ ] 計算式で `<slug>_zavg` が使え、zAvg が null のチームは結果が「なし」になり、式のエラーにはならない
- [ ] MCP `get_team_summary` の結果に `respondents` と `zAvg` / `zRank` が含まれる
- [ ] Sheets「集計」タブの最後に「標準化平均」「標準化順位」の列が出て、既存の列の位置は変わらない
- [ ] 画面の文言に「z スコア」「標準偏差」を本文として出さない（`title` 属性のみ可）
- [ ] `types.ts` の変更が「集計」節だけ、`ResponsesPanel.tsx` の 1〜24 行（import と `stripMarkdown`、`SCORABLE_TYPES`）が無変更
- [ ] `npm run format:check` / `npm run check` / `npm test` / `npm run build` が通る

PR-B

- [ ] `questionDistributions` が rating・上限 1〜20 の number・choice の質問だけ、質問の並び順で出る
- [ ] 区分外の値が `otherCount` に数えられ、未回答と choice の `''` は数えられない
- [ ] 「回答」タブに質問ごとの横棒が CSS だけで表示され、スマホ幅（375px）で横スクロールが出ない

## テスト計画

### 単体（`tests/aggregate.test.ts` に describe を追加）

既存の `makeQuestion` / `makeTeam` を使う（PR #16 が `makeQuestion` に `scaleLabels: null` を足すが、スプレッドなので新しいテストは影響を受けない）。`Question` のオブジェクトリテラルを直接書かない。浮動小数の比較は `toBeCloseTo`。

`computeRespondentSummaries`
- 手計算例 2 の 5 人: 件数・平均・`sd`（P/Q/R は 1、S は 0、T は null）・`avgDiff`（≈ +1.556 / −2.444 / +0.556 / −1.444 / +3.556）・`standardized`（P/Q/R 真、S/T 偽）
- 名簿順に並び、名簿にいて回答 0 件の人は含まれない（名簿の順を回答の順と変えて渡す）
- 回答 0 件なら `[]`
- 重み 2 の質問で、`avg` が重み付きスコアの平均になる

`computeStandardizedTeamAverages`
- 手計算例 1: A 0 / B 1 / C −1、順位 B 1 / A 2 / C 3
- 手計算例 2: S・T を足しても例 1 と同じ値・順位
- 手計算例 3: T だけに採点されたチームと、回答 0 件のチームは `{ zAvg: null, zRank: null }`
- 同点: 対称な回答（例: 2 人が A と B に逆の点を付ける）で A・B が同じ標準化平均 → 同順位

`withStandardized`
- `aggregateTeamSummaries` の結果の並び順（今の順位）を保ったまま `zAvg` / `zRank` が付く

`computeQuestionDistributions`（PR-B）
- 本書の手計算例（rating max 3、choice、number maxScore null は含まない）
- rating `maxScore: null` → 区分 1〜5
- number `maxScore: 2` に 0, 1.5, 2 → 0:1, 1:0, 2:1, その他 1
- text / checkbox は含まない、`sortOrder` 順

### 単体（`tests/sheets.test.ts`）

`buildSummarySheetRows` の既存 3 ケースの `teamRows` に `zAvg` / `zRank` を足し、期待値のヘッダー末尾に `'標準化平均', '標準化順位'`、行末に値（null は `''`）を足す。

### 結合（`tests/integration/api.test.ts`）

**既存の `describe('集計')` の中に** `it` を足す（ファイル末尾は PR #16 が追記しているので避ける）。seed の値は「結合テスト用の seed での値」の表のとおり。

- summary API: `teams` の `[teamName, zAvg, zRank]` が `[['B班', 1, 1], ['A班', -1, 2], ['C班', null, null]]`（`zAvg` は `toBeCloseTo`）、`respondents` が審査員1（2 件・23・`avgDiff` −1.25・`sd` 0・`standardized` false）と審査員2（2 件・25.5・+1.25・3.5・true）の順
- 相互評価フォームの summary: 全チーム `zAvg` null、`respondents` の 2 人とも `sd` null・`standardized` false
- 既存の「重み付きの平均と順位を…」の `it` はそのまま通ること（既存値が変わらないことの確認）
- 計算式: `judge_zavg` → B班 1 位・A班 2 位・C班 null、`error` は null。`peer_zavg` → 全チーム null、`error` は null
- MCP: `POST /mcp` に `{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_team_summary', arguments: { formId } } }` を `Authorization: Bearer ${MCP_TOKEN}` と `Accept: application/json, text/event-stream` で送り、応答（JSON か SSE の `data:` 行）から `result.content[0].text` を JSON として読み、`respondents` の長さ 2 と `teams[0].zRank === 1` を確認する。応答の読み取り関数はこの `describe` の中にローカルに置く（`tests/helpers/` は PR #16 が触っているため）
- PR-B: 審査員フォームの `questionDistributions` が技術力・デザインの 2 件（講評は含まない）、技術力の区分 7〜10 が各 1 件

## 手動確認手順

1. `npm run db:migrate:local` → `npm run dev` → `http://localhost:5173/admin`
2. イベントを作り、チーム A・B・C、メンバー 3 人（各チーム 1 人）、審査員 2 人を登録
3. 相互評価フォームを作り（rating 1〜5 を 1 問）、公開して回答画面から 3 人分回答する（各メンバーは自チームを除く 2 チームを採点）。1 人は 2 チームに同じ点を付ける
4. フォームの「回答」タブで確認
   - チーム別ランキングに「標準化平均」「標準化順位」が並び、並び順は「平均」の順位のまま
   - 同じ点を付けた人が「回答者ごとの傾向」で「使わない（全部同じ点）」になっている
   - 手元で z を計算した値と表示が一致する
5. 審査員フォームで、審査員 1 人が 1 チームだけ回答 →「使わない（回答が1件）」と表示される
6. 「計算式」タブで `peer_zavg` を登録し、イベント画面の計算式結果に値が出る。標準化平均が「-」のチームは結果も「-」
7. スマホ幅（DevTools で 375px）で表が横スクロールで読め、ページ全体は横にはみ出さない
8. （Sheets を設定している場合）「シートへ一括同期」→「<slug>_集計」タブの最後の 2 列に標準化平均・標準化順位が出る
9. （MCP）Claude から `get_team_summary` を呼び、`respondents` と `zAvg` が返る
10. PR-B: 「質問ごとの分布」に rating・choice の横棒が出る。選択肢を 1 つ消してから見ると、その回答が「その他」に数えられる

## 差分見積もり

PR-A（この PR）

| ファイル | 行数（目安） |
|---|---|
| `src/shared/types.ts`（`TeamSummary` 2 項目、`RespondentSummary`、`FormSummary.respondents`） | +25 |
| `src/worker/logic/aggregate.ts` | +85 |
| `src/worker/db.ts`（`listResponsesForScoring`） | +3 / −2 |
| `src/worker/services.ts` | +15 / −4 |
| `src/worker/sheets.ts` | +8 / −1 |
| `src/worker/mcp/tools.ts`、`FormulasTab.tsx`、設計書、architecture.md | +6 / −5 |
| `src/client/pages/admin/editor/ResponsesPanel.tsx` | +65 / −2 |
| `src/client/styles.css` | +10 |
| `tests/aggregate.test.ts` | +110 |
| `tests/sheets.test.ts` | +10 / −6 |
| `tests/integration/api.test.ts` | +55 |
| 合計 | 約 +390 / −20 |

400 行を超えそうなときに削る候補（上から順に）:
1. Sheets「集計」タブの列追加（約 −20 行）→ 別 PR
2. MCP の結合テスト（約 −25 行）→ summary API の結合テストで代える（MCP は同じ `computeFormSummary` を返すだけなので）
3. `avgDiff`（全体との差）（約 −15 行）→ 平均の列だけでも甘辛は読める

PR-B（次の PR）: `types.ts` +12、`aggregate.ts` +45、`services.ts` +3、`ResponsesPanel.tsx` +45、`styles.css` +30、`tests/aggregate.test.ts` +60、`api.test.ts` +12、`tools.ts` の説明 +1 → 約 +210 行

## PR #16・#17 との衝突回避

| ファイル | PR #16（feat/rating-scale-labels） | PR #17（feat/eval-flow-ux） | この PR で触ってよい範囲 |
|---|---|---|---|
| `src/shared/types.ts` | `Question` に `scaleLabels`、`PublicQuestion` のコメント | – | 「集計」節（`TeamSummary` / `FormSummary`、現 118〜133 行）と、その直後への `RespondentSummary` / `QuestionDistribution` の追加だけ |
| `src/worker/db.ts` | 質問の行型・`mapQuestion`・`upsertQuestions`・`mergeQuestions`（60〜700 行台） | – | `listResponsesForScoring`（現 832〜846 行）だけ |
| `src/worker/mcp/tools.ts` | import と `set_questions`（〜300 行） | – | `get_team_summary`（現 328 行付近）と `set_formulas` の describe（現 352 行付近）の文言だけ |
| `src/worker/logic/aggregate.ts`、`services.ts`、`sheets.ts` | – | – | 自由 |
| `src/worker/logic/csv.ts` | – | `stripMarkdown` を `shared/plainText` へ移して再 export | 触らない（`sheets.ts` の `stripMarkdown` の import も変えない） |
| `src/client/pages/admin/editor/ResponsesPanel.tsx` | – | import 1 行追加、`stripMarkdown` 関数の削除（1〜24 行） | `interface Props` 以降の本体の JSX・表示ロジックと、ファイル末尾へのローカル関数追加だけ。**import 行は一切変えない**（新しい型・関数を import しない） |
| `src/client/lib/format.ts` | – | – | 触らない（使うには import 行の変更が要るため。`formatSigned` は `ResponsesPanel.tsx` の末尾に置く） |
| `src/client/styles.css` | 472〜610 行付近の rating セクション、`@media (min-width: 640px)`（現 1302 行〜） | ファイル末尾に追記 | `.data-table thead th`（現 1077 行付近）の直後だけ |
| `src/client/pages/public/*`、`src/shared/evalFlow.ts`、`plainText.ts` | `QuestionField.tsx` | 全般 | 触らない |
| `tests/aggregate.test.ts` | `makeQuestion` に 1 行 | – | 末尾への describe 追加（`makeQuestion` は変えない） |
| `tests/sheets.test.ts` | `makeQuestion` に 1 行 | – | `buildSummarySheetRows` の describe（現 170 行〜）だけ |
| `tests/integration/api.test.ts` | import に 1 行、ファイル末尾に約 230 行 | – | `describe('集計')`（現 254〜345 行）の中だけ |
| `tests/helpers/*` | `d1.ts` | – | 触らない |

実装後、`git merge-tree $(git merge-base HEAD origin/feat/rating-scale-labels) HEAD origin/feat/rating-scale-labels` と `feat/eval-flow-ux` について同様に実行し、衝突が出ないことを PR 本文に書く。どちらかが先にマージされたら、この PR を `main` に rebase して `npm run check` をやり直す（#16 のマージ後は `Question` に `scaleLabels` が必須になるが、この PR は `Question` のリテラルを書かないので型エラーは出ない想定）。
