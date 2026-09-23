# Googleフォームの改善点・UI 調査メモ（formnow 向け）

日付: 2026-09-23
目的: formnow が「Googleフォームでは面倒」を本当に解消できているかを外部情報で裏取りし、次に手を入れるべき UI を決める材料にする。

調査方法: Web 検索（英語・日本語）で Googleフォームの不満・レビュー・代替ツール比較・フォーム設計のベストプラクティス・審査ツールの UX 事例・採点の公平性に関する資料を集め、formnow の現行コード（`src/client/pages/public/*`, `src/client/pages/admin/*`, `styles.css`）と突き合わせた。

---

## 1. Googleフォームに対する不満（一般）

複数のレビューサイト・比較記事で繰り返し挙がる不満は次の 4 系統に集約される（[Jotform](https://www.jotform.com/google-forms/google-forms-problems/)、[Capterra](https://www.capterra.com/p/176571/Google-Forms/reviews/)、[ITreview](https://www.itreview.jp/products/google-forms/reviews)、[getflowforms](https://getflowforms.com/blog/google-forms-limitations)）。

| 系統 | 具体的な不満 | formnow の現状 |
|---|---|---|
| デザイン | 色とヘッダー画像しか変えられず「Googleフォーム特有の見た目」が残る。横並びやグリッド配置ができない | 独自 UI なので該当しない。ただし「見た目が Google っぽくない」ことは訴求点になる |
| ロジック | 分岐が「セクション単位」でしか組めず、設定 UI が分かりにくい。回答による表示/非表示や計算フィールドがない | 相互評価の自チーム除外・重み付けを組み込みで持つ（Google では不可能） |
| 集計 | 概要タブは質問単位のグラフのみ。評価対象（チーム・人）ごとの絞り込みができず、必ずシートに出す | チーム別ランキングと質問別平均をアプリ内で表示 |
| 運用 | 回答の「閲覧のみ」権限がない（編集権限を渡すしかない）。回答内容を管理者が編集できない。モバイルでの編集が弱い | 管理画面はトークン 1 本。閲覧専用は未対応（後述） |

日本語のレビューで特徴的なのは「条件分岐の作り方が分かりにくい」「テスト実行（プレビュー）の導線が分かりにくい」「履歴・やりとりの管理ができない」の 3 点（[ITreview](https://www.itreview.jp/products/google-forms/reviews)、[formLab](https://form.run/media/contents/form-creation-tools/googleform-disadvantages/)）。

## 2. 審査・採点用途での限界（formnow の存在意義に直結）

評価フォームの解説記事と、Googleフォームで審査していたハッカソンの UX 事例から（[Formester](https://formester.com/blog/google-form-evaluation/)、[HackDavis Judging App](https://www.sechankim.com/hd-judging)、[TCEA rubrics](https://blog.tcea.org/google-forms/)）。

- **計算フィールドがない**: 質問間の掛け算・平均ができない。重み付けは必ずシート側の数式になる。しかも新しい回答は数式の下に追記されるので `ARRAYFORMULA` で包まないと 3 行目以降の合計が出ない
- **グリッドの回答は数値でなく文字列**: 列ラベルを「1〜5」にするかシートで変換しないと数式が動かない
- **匿名と 1 人 1 回の両立ができない**: 「回答を 1 回に制限」は Google ログイン必須。この問題は 2020 年から未解決とコミュニティで指摘されている
- **審査員がチーム名を手入力する**: HackDavis の調査では「チーム名・番号の手入力による人的ミス」と「冗長なセクションで採点欄が多すぎる」が最大の不満だった。解決策は「審査員ごとにカスタマイズされたプロジェクト一覧」と「1 プロジェクト 1 画面」
- **評価対象ごとの集計が出ない**: 「集計タブは質問ごとにグラフを描くが、評価対象 1 件で絞れない」

formnow はこの 5 点をすべてアーキテクチャで解決済み（重み・計算式、名前選択のみでログイン不要、チームを順番に 1 画面ずつ、チーム別集計）。ここは README/LP でもっと強く打ち出してよい。

## 3. 回答 UI のベストプラクティス

### 3.1 評価スケール

- Google の「均等目盛」は両端しかラベルが付かず、中間の 2・3・4 の意味を回答者が推測することになる。全点にラベルを付けるのが推奨（[PlatoForms](https://www.platoforms.com/blog/google-forms-likert-scale-comprehensive-guide/)）
- スマホでは横一列で収まるのは 5 点まで。7 点で窮屈になり、10 点では誤タップが増える。7 点以上は縦積み or 2 段にする（[PlatoForms](https://www.platoforms.com/blog/google-forms-likert-scale-comprehensive-guide/)、[SheetMergy](https://sheetmergy.com/blog/google-forms-linear-scale)）
- 「質問を読んで 3 秒以内に答えられる」を目安にする
- **日本の心理学研究（J-STAGE, 大学生 1,108 名）**: Googleフォームのグリッド形式はスマホで横スワイプが必要になり、不注意回答が 12.1% と他形式より大幅に多く、見やすさ評価も最低（2.97/7）。ラジオボタン形式が紙に最も近い結果。均等目盛は選択肢の文字情報が欠けるため順序尺度には不向き（[スマートフォンによる回答形式の違いが心理尺度の回答に及ぼす影響](https://www.jstage.jst.go.jp/article/jjpsy/advpub/0/advpub_96.24304/_html/-char/ja)）

### 3.2 マルチステップ・モバイル

- タップ領域は最低 48px。入力欄のフォントは 16px 以上（iOS の自動ズーム防止）（[Venture Harbour](https://ventureharbour.com/form-design-best-practices/)）
- 進捗表示は離脱を 20〜25% 減らす。5 ステップ以上なら「%」より「各ステップに名前が付いたインジケーター」が良い（[Anve](https://anveforms.com/blog/multi-step-form-best-practices/)）
- 「戻る」で入力内容が消えるのはマルチステップフォームで最も多い失敗
- 3〜4 ステップを超えるなら自動保存し、閉じても前回の位置から再開できるようにする
- バリデーションは各ステップ内で即時に出す。最後にまとめてエラー一覧を出さない
- 送信ボタンは「送信」ではなく結果が分かるラベルにする

### 3.3 審査員向けツールの知見

- 審査員は自分専用リンクで、同じルーブリックを 1〜10 のスケールで採点し、基準ごとに重みを持つのが標準（[ScoreJudge](https://scorejudge.com/judging-software-for-hackathons/)）
- 基準は「2 人の審査員が同じデモを見てほぼ同じ点に着地する」程度に具体的に書く。各基準の意味をフォーム上で説明する（[DoraHacks](https://dev.to/dorahacks/how-to-design-a-hackathon-judging-plan)）
- 審査員ごとに甘辛の癖がある。「75 点を高評価とする審査員」と「最低点として付ける審査員」が混在する。全審査員が全チームを採点するなら平均で相殺されるが、**一部のチームしか採点しない場合は z スコア標準化（審査員ごとに平均 0・分散 1 に揃える）が必要**（[HeroX](https://www.herox.com/help/77-guide-standardizing-the-judges-scores)、[Entropy 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12191665/)）
  - formnow の相互評価は自チームをスキップするため、まさに「各チームを異なる部分集合が採点する」構造。素の平均だと甘い評価者の多いチームが有利になる
- 確認画面に計算済みスコアを出すと回答者の納得感が上がる（[Formester](https://formester.com/blog/google-form-evaluation/)）

## 4. Googleフォームが最近追いついた点（差別化が薄れる部分）

- 2024〜2025: 星・ハート・親指の「評価」質問タイプを追加。回答者の自動保存（30 日、ただし Google ログイン時のみ）
- 2026-01: 日時・件数による自動クローズ
- 2026-02: Gemini による「フォームの下書き生成」と自由記述の要約インサイト
- 2026: 回答者を個人・グループ単位で制限する共有コントロール

（[Google Workspace Updates](https://workspaceupdates.googleblog.com/2026/01/granular-controls-google-forms-responses.html)、[chromeunboxed](https://chromeunboxed.com/google-forms-gets-an-super-helpful-new-feature/)、[TeacherCast](https://teachercast.net/instructional-coaching/gemini-google-forms-guide/)）

「MCP で Claude から作れる」は Gemini 統合と競合する。差別化は生成そのものではなく「チーム・回答者・重み・計算式まで一貫して扱える」点に置くべき。

---

## 5. formnow への具体的提案（コードと照合済み）

優先度は「回答者が当日スマホで使う場面の摩擦」を最重視して付けた。

### 高: 回答画面（審査員・メンバーが当日使う）

1. **評価ボタンの点ごとのラベル**（`QuestionField.tsx` の `rating`）
   現状は 1〜max の数字ボタンのみで、Google の均等目盛と同じ「両端すら無ラベル」状態。質問ごとに任意で「1=改善が必要 … 5=非常に良い」などのアンカーラベルを持てるようにし、少なくとも両端は表示する。J-STAGE の研究とPlatoForms の指摘に対応。
2. **タップ領域を 48px に**（`styles.css` `.rating-btn` は 42px）
   ガイドラインの 48px 未満。10 点満点だと 42px×10+gap で約 490px になり、スマホでは 2 行に折り返して 1 段目と 2 段目の境界で誤タップしやすい。7 点以上は 2 段固定 or 縦積みにレイアウトを切り替える。
3. **進捗をチーム名付きステップ表示に**（`TeamEvaluationStep.tsx` の `progressLabel` は「3 / 5 チーム目」のテキストのみ）
   5 チーム以上が普通なので、名前付きインジケーターにし、済みチームをタップで開けるようにする（HackDavis の「審査員ごとの一覧」に相当）。完了画面には既に一覧があるので、それを評価中にも常設する。
4. **回答中の名前を常時表示**（`FormFlow.tsx` のヘッダーは「別の名前で回答する」リンクのみ）
   ドロップダウンで隣の名前を選ぶミスは HackDavis の「手入力ミス」と同種。「◯◯さんとして回答中」を出す。同じ端末を複数人で回すケース（審査員席の共用タブレット）でも事故が減る。
5. **最後のチームではボタンを「保存して完了」に**（現状は常に「このチームの評価を保存して次へ」）
   結果が分かるラベルにするというベストプラクティスに沿う。
6. **エラー時に最初の未入力項目までスクロール**（`validate()` はエラーを設定するが画面は動かない）
   質問数が多いと、上部のエラー文だけでは何が未入力か見えない。
7. **完了画面に自分の採点サマリー**（`CompletionStep.tsx`）
   チームごとの自分の合計点を並べると「A班に B班より高い点を付けたか」を見直せる。Formester の「確認画面に計算済みスコア」。

すでに満たしている点: 1 チーム 1 画面（グリッド回避）、サーバー保存＋localStorage による再開、ステップ内バリデーション、入力フォント 16px、戻っても入力が残る。ここは崩さない。

### 中: 集計（主催者が当日使う）

8. **審査員別の甘辛可視化と z スコア標準化オプション**（`ResponsesPanel.tsx` はチーム別のみ）
   審査員ごとの平均・分散を一覧にし、相互評価（自チーム除外で採点集合が偏る）では標準化平均を併記できるようにする。計算式の変数に `<slug>_zavg` を足す形が既存設計と整合する。
9. **質問別の分布**
   現状は平均のみ。1〜5 の分布（ヒストグラム）があると「この質問は全員 5 を付けていて差が出ない」が見える。Google の概要タブが唯一得意な部分に追いつく。
10. **閲覧専用トークン**
    Google の不満「回答を見るだけの権限がない」は formnow にもそのまま当てはまる（`ADMIN_TOKEN` 1 本）。当日の司会・集計係に配れる read-only トークンがあると、運営で複数人が触れる。

### 低: エディタ

11. **配点上限と重みから「満点目安」をエディタでも表示**（`QuestionEditor.tsx`）
    集計タブにはあるが、質問を編集している最中に「今この質問は合計の何割か」が見えると重みの調整が楽。
12. **評価質問のプリセット**
    「1〜5・両端ラベル付き」「1〜10」など 2〜3 個のテンプレートを型選択の横に置く。Google の「星・ハート」に相当する手軽さ。

---

## 参考リンク一覧

不満・レビュー
- https://www.jotform.com/google-forms/google-forms-problems/
- https://www.capterra.com/p/176571/Google-Forms/reviews/
- https://www.itreview.jp/products/google-forms/reviews
- https://form.run/media/contents/form-creation-tools/googleform-disadvantages/
- https://getflowforms.com/blog/google-forms-limitations
- https://www.platoforms.com/blog/google-forms-team-collaboration-limitations/

審査・採点用途
- https://formester.com/blog/google-form-evaluation/
- https://www.sechankim.com/hd-judging
- https://blog.tcea.org/google-forms/
- https://scorejudge.com/judging-software-for-hackathons/
- https://dev.to/dorahacks/how-to-design-a-hackathon-judging-plan
- https://www.herox.com/help/77-guide-standardizing-the-judges-scores
- https://pmc.ncbi.nlm.nih.gov/articles/PMC12191665/

回答 UI のベストプラクティス
- https://www.platoforms.com/blog/google-forms-likert-scale-comprehensive-guide/
- https://www.jstage.jst.go.jp/article/jjpsy/advpub/0/advpub_96.24304/_html/-char/ja
- https://ventureharbour.com/form-design-best-practices/
- https://anveforms.com/blog/multi-step-form-best-practices/
- https://www.sogolytics.com/blog/best-practices-mobile-survey-design/
- https://sheetmergy.com/blog/google-forms-linear-scale

Googleフォームの最近の更新
- https://workspaceupdates.googleblog.com/2026/01/granular-controls-google-forms-responses.html
- https://chromeunboxed.com/google-forms-gets-an-super-helpful-new-feature/
- https://teachercast.net/instructional-coaching/gemini-google-forms-guide/

代替ツール比較
- https://tally.so/help/compare
- https://www.jotform.com/google-forms/google-forms-vs-tally-forms/
- https://typeformalternative.com/google-forms-vs-typeform
