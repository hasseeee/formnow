import { describe, expect, it } from 'vitest';
import {
  aggregateTeamSummaries,
  computeRanks,
  sortByRank,
  type AggregateResponseInput,
} from '../src/worker/logic/aggregate';
import type { Question, Team } from '../src/shared/types';

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 1,
    formId: 1,
    sortOrder: 0,
    type: 'rating',
    labelMd: 'Q',
    options: null,
    maxScore: 5,
    weight: 1,
    required: true,
    ...overrides,
  };
}

function makeTeam(id: number, name: string, sortOrder = 0): Team {
  return { id, eventId: 1, name, sortOrder };
}

describe('computeRanks', () => {
  it('降順にrankを付ける', () => {
    const ranks = computeRanks([
      { id: 1, value: 10 },
      { id: 2, value: 30 },
      { id: 3, value: 20 },
    ]);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(3)).toBe(2);
    expect(ranks.get(1)).toBe(3);
  });

  it('同点は同順位になり、次の順位はスキップされる', () => {
    const ranks = computeRanks([
      { id: 1, value: 90 },
      { id: 2, value: 90 },
      { id: 3, value: 80 },
    ]);
    expect(ranks.get(1)).toBe(1);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(3)).toBe(3);
  });

  it('valueがnullのエントリはrankもnullになる', () => {
    const ranks = computeRanks([
      { id: 1, value: 50 },
      { id: 2, value: null },
    ]);
    expect(ranks.get(1)).toBe(1);
    expect(ranks.get(2)).toBeNull();
  });

  it('全てnullならすべてrank null', () => {
    const ranks = computeRanks([
      { id: 1, value: null },
      { id: 2, value: null },
    ]);
    expect(ranks.get(1)).toBeNull();
    expect(ranks.get(2)).toBeNull();
  });
});

describe('aggregateTeamSummaries', () => {
  const questions: Question[] = [
    makeQuestion({ id: 1, type: 'rating', weight: 1, maxScore: 5 }),
    makeQuestion({ id: 2, type: 'text' }),
  ];
  const teams: Team[] = [makeTeam(1, 'Team A'), makeTeam(2, 'Team B'), makeTeam(3, 'Team C')];

  it('チームごとの count/sum/avg を計算する', () => {
    const responses: AggregateResponseInput[] = [
      { teamId: 1, answers: [{ questionId: 1, value: 4 }] },
      { teamId: 1, answers: [{ questionId: 1, value: 2 }] },
      { teamId: 2, answers: [{ questionId: 1, value: 5 }] },
    ];
    const summaries = aggregateTeamSummaries(responses, questions, teams);
    const teamA = summaries.find((s) => s.teamId === 1)!;
    const teamB = summaries.find((s) => s.teamId === 2)!;
    const teamC = summaries.find((s) => s.teamId === 3)!;

    expect(teamA.count).toBe(2);
    expect(teamA.sum).toBe(6);
    expect(teamA.avg).toBe(3);

    expect(teamB.count).toBe(1);
    expect(teamB.sum).toBe(5);
    expect(teamB.avg).toBe(5);

    expect(teamC.count).toBe(0);
    expect(teamC.sum).toBe(0);
    expect(teamC.avg).toBeNull();
    expect(teamC.rank).toBeNull();
  });

  it('avg降順でrankが付き、count=0のチームはavg/rankともにnull', () => {
    const responses: AggregateResponseInput[] = [
      { teamId: 1, answers: [{ questionId: 1, value: 3 }] },
      { teamId: 2, answers: [{ questionId: 1, value: 5 }] },
    ];
    const summaries = aggregateTeamSummaries(responses, questions, teams);
    const byId = new Map(summaries.map((s) => [s.teamId, s]));
    expect(byId.get(2)!.rank).toBe(1);
    expect(byId.get(1)!.rank).toBe(2);
    expect(byId.get(3)!.rank).toBeNull();
  });

  it('同点のチームは同順位になる', () => {
    const responses: AggregateResponseInput[] = [
      { teamId: 1, answers: [{ questionId: 1, value: 4 }] },
      { teamId: 2, answers: [{ questionId: 1, value: 4 }] },
      { teamId: 3, answers: [{ questionId: 1, value: 2 }] },
    ];
    const summaries = aggregateTeamSummaries(responses, questions, teams);
    const byId = new Map(summaries.map((s) => [s.teamId, s]));
    expect(byId.get(1)!.rank).toBe(1);
    expect(byId.get(2)!.rank).toBe(1);
    expect(byId.get(3)!.rank).toBe(3);
  });

  it('questionAvgsは採点対象の質問のみを含む', () => {
    const responses: AggregateResponseInput[] = [
      {
        teamId: 1,
        answers: [
          { questionId: 1, value: 4 },
          { questionId: 2, value: '自由記述' },
        ],
      },
      { teamId: 1, answers: [{ questionId: 1, value: 2 }] },
    ];
    const summaries = aggregateTeamSummaries(responses, questions, teams);
    const teamA = summaries.find((s) => s.teamId === 1)!;
    expect(teamA.questionAvgs).toEqual({ 1: 3 });
    expect(teamA.questionAvgs[2]).toBeUndefined();
  });

  it('回答が全く無いチームのquestionAvgsは空になる', () => {
    const summaries = aggregateTeamSummaries([], questions, teams);
    const teamA = summaries.find((s) => s.teamId === 1)!;
    expect(teamA.questionAvgs).toEqual({});
  });

  it('返り値はrank昇順にソートされる (rank=nullは末尾)', () => {
    const responses: AggregateResponseInput[] = [
      { teamId: 1, answers: [{ questionId: 1, value: 3 }] },
      { teamId: 2, answers: [{ questionId: 1, value: 5 }] },
      // teamId 3 は回答無し (avg=null, rank=null)
    ];
    const summaries = aggregateTeamSummaries(responses, questions, teams);
    expect(summaries.map((s) => s.teamId)).toEqual([2, 1, 3]);
    expect(summaries.map((s) => s.rank)).toEqual([1, 2, null]);
  });
});

describe('sortByRank', () => {
  it('rank昇順に並べ替える', () => {
    const items = [
      { id: 'a', rank: 3 },
      { id: 'b', rank: 1 },
      { id: 'c', rank: 2 },
    ];
    expect(sortByRank(items).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('rank=nullは末尾に配置される', () => {
    const items = [
      { id: 'a', rank: null },
      { id: 'b', rank: 1 },
    ];
    expect(sortByRank(items).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('rank=null同士は元の並び順 (sort_order順) を維持する', () => {
    const items = [
      { id: 'a', rank: null },
      { id: 'b', rank: null },
      { id: 'c', rank: 1 },
    ];
    expect(sortByRank(items).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});
