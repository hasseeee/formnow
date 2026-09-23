// 純粋関数: 回答リスト＋チームリストからチーム別集計・回答者ごとの傾向・標準化平均を計算する。D1に依存しない。
import type {
  AnswerValue,
  Question,
  Respondent,
  RespondentSummary,
  Team,
  TeamSummary,
} from '../../shared/types';
import { isScorable, numericValue, responseScore } from './scoring';

export interface AggregateResponseInput {
  teamId: number;
  answers: { questionId: number; value: AnswerValue }[];
}

/** 回答者IDつきの回答。標準化・回答者別集計の入力 */
export interface ScoredResponseInput extends AggregateResponseInput {
  respondentId: number;
}

/** zAvg / zRank を付ける前のチーム別集計 */
export type BaseTeamSummary = Omit<TeamSummary, 'zAvg' | 'zRank'>;

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
): BaseTeamSummary[] {
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

/** 浮動小数の誤差で 0 にならない「ばらつき 0」を 0 とみなすしきい値 */
const SD_EPSILON = 1e-9;

interface RespondentStats {
  count: number;
  avg: number;
  /** 母標準偏差。回答1件なら null */
  sd: number | null;
  /** 標準化平均に使うか（回答2件以上かつばらつきが0でない） */
  standardized: boolean;
}

/** 回答者ごとの件数・平均・母標準偏差を回答の出現順に計算する（2関数で共有する内部関数） */
function respondentStats(
  responses: ScoredResponseInput[],
  questions: Question[],
): Map<number, RespondentStats> {
  const scoresByRespondent = new Map<number, number[]>();
  for (const response of responses) {
    const list = scoresByRespondent.get(response.respondentId) ?? [];
    list.push(responseScore(questions, response.answers));
    scoresByRespondent.set(response.respondentId, list);
  }

  const stats = new Map<number, RespondentStats>();
  for (const [respondentId, scores] of scoresByRespondent) {
    const count = scores.length;
    const avg = scores.reduce((a, b) => a + b, 0) / count;
    // 母標準偏差 (n で割る): 実際に付けた点の散らばりそのものを見るため。設計書 2026-09-23 参照
    const sd =
      count >= 2 ? Math.sqrt(scores.reduce((acc, s) => acc + (s - avg) ** 2, 0) / count) : null;
    const standardized = sd !== null && sd > SD_EPSILON;
    stats.set(respondentId, { count, avg, sd, standardized });
  }
  return stats;
}

/**
 * 回答者ごとの傾向（件数・平均・全体との差・ばらつき・標準化に使うか）。
 * respondents は名簿順で渡す。1件も回答していない人と、名簿にない回答者は含めない。
 */
export function computeRespondentSummaries(
  responses: ScoredResponseInput[],
  questions: Question[],
  respondents: Pick<Respondent, 'id' | 'name'>[],
): RespondentSummary[] {
  if (responses.length === 0) return [];
  const stats = respondentStats(responses, questions);
  // 全体平均は回答1件を1票として数える
  const overallAvg =
    responses.reduce((acc, r) => acc + responseScore(questions, r.answers), 0) / responses.length;

  const summaries: RespondentSummary[] = [];
  for (const respondent of respondents) {
    const s = stats.get(respondent.id);
    if (!s) continue;
    summaries.push({
      respondentId: respondent.id,
      respondentName: respondent.name,
      count: s.count,
      avg: s.avg,
      avgDiff: s.avg - overallAvg,
      sd: s.sd,
      standardized: s.standardized,
    });
  }
  return summaries;
}

/**
 * チームごとの標準化平均と標準化順位。
 * 標準化に使う回答者の回答だけを z = (スコア − その人の平均) / その人のばらつき に変換し、チームごとに平均する。
 * 回答1件だけ・全部同じ点の回答者の回答は使わない (z=0 にもしない)。使える回答がないチームは null。
 */
export function computeStandardizedTeamAverages(
  responses: ScoredResponseInput[],
  questions: Question[],
  teams: Pick<Team, 'id'>[],
): Map<number, { zAvg: number | null; zRank: number | null }> {
  const stats = respondentStats(responses, questions);

  const zByTeam = new Map<number, number[]>();
  for (const team of teams) zByTeam.set(team.id, []);
  for (const response of responses) {
    const s = stats.get(response.respondentId);
    const list = zByTeam.get(response.teamId);
    if (!s || !s.standardized || s.sd === null || !list) continue;
    list.push((responseScore(questions, response.answers) - s.avg) / s.sd);
  }

  const zAvgs = teams.map((team) => {
    const zs = zByTeam.get(team.id) ?? [];
    return { id: team.id, zAvg: zs.length > 0 ? zs.reduce((a, b) => a + b, 0) / zs.length : null };
  });
  // 数学的に同じ値が浮動小数で僅かにずれて別順位にならないよう、順位付けにだけ丸めた値を使う
  const rankMap = computeRanks(
    zAvgs.map((t) => ({
      id: t.id,
      value: t.zAvg === null ? null : Math.round(t.zAvg * 1e9) / 1e9,
    })),
  );

  const result = new Map<number, { zAvg: number | null; zRank: number | null }>();
  for (const t of zAvgs) result.set(t.id, { zAvg: t.zAvg, zRank: rankMap.get(t.id) ?? null });
  return result;
}

/** BaseTeamSummary に zAvg / zRank を付ける（並び順は変えない） */
export function withStandardized(
  teams: BaseTeamSummary[],
  z: Map<number, { zAvg: number | null; zRank: number | null }>,
): TeamSummary[] {
  return teams.map((t) => ({
    ...t,
    zAvg: z.get(t.teamId)?.zAvg ?? null,
    zRank: z.get(t.teamId)?.zRank ?? null,
  }));
}
