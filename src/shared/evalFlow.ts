// 純粋関数: 回答画面の流れ（次に開くチーム・ボタン文言の種類・ステップ表示・完了サマリー）の判定。
// DOM・React に依存しない（client と tests から使う。worker の型チェックにも入る）。
import { stripMarkdown } from './plainText';
import type { AnswerValue, PublicQuestion, Team } from './types';

// TeamEvaluationStep.tsx の AnswerMap と同じ形（React のファイルを読み込まないためここで書く）
type Answers = Record<number, AnswerValue | null>;

/** 完了サマリーのラベルをこの文字数で省略する */
const SUMMARY_LABEL_MAX = 12;

/** fromIndex より後ろの最初の未回答チーム。なければ先頭から探す。全部済みなら -1。
 *  初回の再開位置は fromIndex = -1 で呼ぶ（先頭から探す＝現状の findIndex と同じ）。 */
export function findNextTeamIndex(
  teams: Pick<Team, 'id'>[],
  completed: ReadonlySet<number>,
  fromIndex: number,
): number {
  for (let i = fromIndex + 1; i < teams.length; i++) {
    if (!completed.has(teams[i].id)) return i;
  }
  for (let i = 0; i <= Math.min(fromIndex, teams.length - 1); i++) {
    if (!completed.has(teams[i].id)) return i;
  }
  return -1;
}

export type SubmitMode = 'next' | 'finish' | 'edit-next' | 'edit-finish';

/** 表「ボタン文言」の判定。teams に含まれない completed の ID は無視する */
export function getSubmitMode(
  teams: Pick<Team, 'id'>[],
  completed: ReadonlySet<number>,
  currentTeamId: number,
): SubmitMode {
  const isEdit = completed.has(currentTeamId);
  // 保存後に未回答が残らないか（今のチーム以外がすべて済みか）
  const finishes = teams.every((t) => t.id === currentTeamId || completed.has(t.id));
  if (isEdit) return finishes ? 'edit-finish' : 'edit-next';
  return finishes ? 'finish' : 'next';
}

export type TeamStepStatus = 'current' | 'done' | 'todo';

/** ステップ表示のチップの状態。優先順位は 評価中 > 済み > 未回答 */
export function getTeamStepStatus(
  teamId: number,
  index: number,
  currentIndex: number,
  completed: ReadonlySet<number>,
): TeamStepStatus {
  if (index === currentIndex) return 'current';
  if (completed.has(teamId)) return 'done';
  return 'todo';
}

export interface AnswerSummaryItem {
  questionId: number;
  /** 平文化・12文字で省略済み */
  label: string;
  /** 平文化のみ（title 用） */
  fullLabel: string;
  value: number | null;
  /** rating は maxScore ?? 5、number は maxScore */
  max: number | null;
}

export interface TeamAnswerSummary {
  teamId: number;
  teamName: string;
  /** rating / number のみ、sortOrder 順 */
  items: AnswerSummaryItem[];
}

/** 完了画面用。teams の順に 1 チーム 1 件（回答がないチームも items の value を null で返す） */
export function buildAnswerSummary(
  teams: Pick<Team, 'id' | 'name'>[],
  questions: PublicQuestion[],
  answersByTeam: Record<number, Answers>,
): TeamAnswerSummary[] {
  const sorted = [...questions].sort((a, b) => a.sortOrder - b.sortOrder);
  // 質問ごとのラベルと上限はチームによらないので先に作る
  const columns = sorted.flatMap((q, i) => {
    if (q.type !== 'rating' && q.type !== 'number') return [];
    // 平文化して空になったら全質問の中での並び順で表す
    const fullLabel = stripMarkdown(q.labelMd) || `質問${i + 1}`;
    const chars = Array.from(fullLabel);
    const label =
      chars.length > SUMMARY_LABEL_MAX
        ? `${chars.slice(0, SUMMARY_LABEL_MAX).join('')}…`
        : fullLabel;
    const max = q.type === 'rating' ? (q.maxScore ?? 5) : q.maxScore;
    return [{ questionId: q.id, label, fullLabel, max }];
  });

  return teams.map((t) => {
    const answers = answersByTeam[t.id] ?? {};
    return {
      teamId: t.id,
      teamName: t.name,
      items: columns.map((c) => {
        const v = answers[c.questionId];
        return { ...c, value: typeof v === 'number' ? v : null };
      }),
    };
  });
}
