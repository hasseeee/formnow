// 純粋関数: 回答リスト＋チームリストからチーム別集計を行う。D1に依存しない。
import type { AnswerValue, Question, Team, TeamSummary } from '../../shared/types';
import { isScorable, numericValue, responseScore } from './scoring';

export interface AggregateResponseInput {
  teamId: number;
  answers: { questionId: number; value: AnswerValue }[];
}

/**
 * rank昇順でソートする (rank=nullは末尾、null同士は元の並び順=sort_order順を維持する)。
 */
export function sortByRank<T extends { rank: number | null }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.rank === null && b.item.rank === null) return a.index - b.index;
      if (a.item.rank === null) return 1;
      if (b.item.rank === null) return -1;
      return a.item.rank - b.item.rank;
    })
    .map(({ item }) => item);
}

/**
 * value 降順で順位付けする。同点は同順位（標準競技順位: 1,1,3 方式）。
 * value が null のエントリは avg=null 相当として rank=null になる。
 */
export function computeRanks(
  entries: { id: number; value: number | null }[],
): Map<number, number | null> {
  const sorted = [...entries].sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return b.value - a.value;
  });

  const rankMap = new Map<number, number | null>();
  let prevValue: number | null = null;
  let prevRank = 0;
  sorted.forEach((entry, idx) => {
    if (entry.value === null) {
      rankMap.set(entry.id, null);
      return;
    }
    if (prevValue !== null && entry.value === prevValue) {
      rankMap.set(entry.id, prevRank);
    } else {
      const rank = idx + 1;
      rankMap.set(entry.id, rank);
      prevRank = rank;
      prevValue = entry.value;
    }
  });
  return rankMap;
}

/**
 * 回答リストとチームリストから TeamSummary[] を計算する。
 * - avg 降順で rank 付け。同点は同順位
 * - count=0 のチームは avg=null, rank=null
 * - questionAvgs は採点対象の質問のみ（回答が無い質問はキーに含めない）
 */
export function aggregateTeamSummaries(
  responses: AggregateResponseInput[],
  questions: Question[],
  teams: Team[],
): TeamSummary[] {
  const scoredQuestions = questions.filter((q) => isScorable(q));

  const responsesByTeam = new Map<number, AggregateResponseInput[]>();
  for (const team of teams) responsesByTeam.set(team.id, []);
  for (const response of responses) {
    const list = responsesByTeam.get(response.teamId) ?? [];
    list.push(response);
    responsesByTeam.set(response.teamId, list);
  }

  const partials = teams.map((team) => {
    const teamResponses = responsesByTeam.get(team.id) ?? [];
    const count = teamResponses.length;
    const sum = teamResponses.reduce((acc, r) => acc + responseScore(questions, r.answers), 0);
    const avg = count > 0 ? sum / count : null;

    const questionAvgs: Record<number, number> = {};
    for (const question of scoredQuestions) {
      const values: number[] = [];
      for (const response of teamResponses) {
        const answer = response.answers.find((a) => a.questionId === question.id);
        if (!answer) continue;
        const value = numericValue(question, answer.value);
        if (value !== null) values.push(value);
      }
      if (values.length > 0) {
        questionAvgs[question.id] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }

    return { teamId: team.id, teamName: team.name, count, sum, avg, questionAvgs };
  });

  const rankMap = computeRanks(partials.map((p) => ({ id: p.teamId, value: p.avg })));

  const summaries = partials.map((p) => ({
    teamId: p.teamId,
    teamName: p.teamName,
    count: p.count,
    sum: p.sum,
    avg: p.avg,
    rank: rankMap.get(p.teamId) ?? null,
    questionAvgs: p.questionAvgs,
  }));

  return sortByRank(summaries);
}
