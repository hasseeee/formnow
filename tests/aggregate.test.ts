import { describe, expect, it } from 'vitest';
import {
  aggregateTeamSummaries,
  computeRanks,
  computeQuestionDistributions,
  computeRespondentSummaries,
  computeStandardizedTeamAverages,
  sortByRank,
  withStandardized,
  type AggregateResponseInput,
  type ScoredResponseInput,
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
    scaleLabels: null,
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

// ---------- 回答者ごとの傾向・標準化平均（設計書 2026-09-23-judge-calibration の手計算例） ----------

describe('回答者ごとの傾向と標準化平均', () => {
  // rating 1問・重み1（スコア = 点数）
  const questions = [makeQuestion({ id: 1, maxScore: 10 })];
  const [A, B, C, D, E] = [1, 2, 3, 4, 5];
  const [P, Q, R, S, T] = [11, 12, 13, 14, 15];
  const teams = [makeTeam(A, 'A'), makeTeam(B, 'B'), makeTeam(C, 'C')];

  function scored(respondentId: number, teamId: number, value: number): ScoredResponseInput {
    return { respondentId, teamId, answers: [{ questionId: 1, value }] };
  }

  /** 手計算例1: P(甘め)・Q(辛め)・R が2チームずつ採点 */
  const example1: ScoredResponseInput[] = [
    scored(P, A, 9),
    scored(P, C, 7),
    scored(Q, B, 5),
    scored(Q, C, 3),
    scored(R, A, 6),
    scored(R, B, 8),
  ];
  /** 手計算例2: 例1 + S(全部同じ点) + T(回答1件) */
  const example2: ScoredResponseInput[] = [
    ...example1,
    scored(S, A, 5),
    scored(S, B, 5),
    scored(T, C, 10),
  ];
  const roster = [
    { id: P, name: 'P' },
    { id: Q, name: 'Q' },
    { id: R, name: 'R' },
    { id: S, name: 'S' },
    { id: T, name: 'T' },
  ];

  describe('computeRespondentSummaries', () => {
    it('手計算例2: 件数・平均・ばらつき・全体との差・標準化に使うかを返す', () => {
      const result = computeRespondentSummaries(example2, questions, roster);
      expect(result.map((r) => [r.respondentName, r.count, r.avg, r.sd, r.standardized])).toEqual([
        ['P', 2, 8, 1, true],
        ['Q', 2, 4, 1, true],
        ['R', 2, 7, 1, true],
        ['S', 2, 5, 0, false],
        ['T', 1, 10, null, false],
      ]);
      const diffs = result.map((r) => r.avgDiff);
      [1.556, -2.444, 0.556, -1.444, 3.556].forEach((expected, i) =>
        expect(diffs[i]).toBeCloseTo(expected, 3),
      );
      expect(result[0].respondentId).toBe(P);
    });

    it('名簿順に並び、回答0件の人は含まない', () => {
      const result = computeRespondentSummaries(example1, questions, [
        { id: R, name: 'R' },
        { id: S, name: 'S' },
        { id: P, name: 'P' },
        { id: Q, name: 'Q' },
      ]);
      expect(result.map((r) => r.respondentName)).toEqual(['R', 'P', 'Q']);
    });

    it('回答0件なら空配列', () => {
      expect(computeRespondentSummaries([], questions, roster)).toEqual([]);
    });

    it('avg は重み付きスコアの平均になる', () => {
      const weighted = [makeQuestion({ id: 1, maxScore: 10, weight: 2 })];
      const result = computeRespondentSummaries(
        [scored(P, A, 3), scored(P, B, 5)],
        weighted,
        roster,
      );
      expect(result[0].avg).toBe(8); // (6 + 10) / 2
      expect(result[0].sd).toBe(2);
    });
  });

  describe('computeStandardizedTeamAverages', () => {
    it('手計算例1: 素の平均と順位が入れ替わる', () => {
      const z = computeStandardizedTeamAverages(example1, questions, teams);
      expect(z.get(A)?.zAvg).toBeCloseTo(0);
      expect(z.get(B)?.zAvg).toBeCloseTo(1);
      expect(z.get(C)?.zAvg).toBeCloseTo(-1);
      expect([z.get(B)?.zRank, z.get(A)?.zRank, z.get(C)?.zRank]).toEqual([1, 2, 3]);
    });

    it('手計算例2: 回答1件・全部同じ点の人は除外され、例1と同じ値・順位になる', () => {
      const z = computeStandardizedTeamAverages(example2, questions, teams);
      expect(z.get(A)?.zAvg).toBeCloseTo(0);
      expect(z.get(B)?.zAvg).toBeCloseTo(1);
      expect(z.get(C)?.zAvg).toBeCloseTo(-1);
      expect([z.get(B)?.zRank, z.get(A)?.zRank, z.get(C)?.zRank]).toEqual([1, 2, 3]);
    });

    it('手計算例3: 除外される人だけが採点したチームと回答0件のチームは null', () => {
      const z = computeStandardizedTeamAverages([...example1, scored(T, D, 10)], questions, [
        ...teams,
        makeTeam(D, 'D'),
        makeTeam(E, 'E'),
      ]);
      expect(z.get(D)).toEqual({ zAvg: null, zRank: null });
      expect(z.get(E)).toEqual({ zAvg: null, zRank: null });
      expect(z.get(B)?.zRank).toBe(1);
    });

    it('同じ標準化平均のチームは同順位になる', () => {
      const z = computeStandardizedTeamAverages(
        [scored(P, A, 9), scored(P, B, 7), scored(Q, A, 2), scored(Q, B, 4), scored(R, C, 5)],
        questions,
        teams,
      );
      expect(z.get(A)?.zAvg).toBeCloseTo(0);
      expect(z.get(B)?.zAvg).toBeCloseTo(0);
      expect([z.get(A)?.zRank, z.get(B)?.zRank, z.get(C)?.zRank]).toEqual([1, 1, null]);
    });

    it('数学的に同じ標準化平均が浮動小数の誤差でずれても、同順位になる', () => {
      // 3人とも {1, 2, 4} を配点。A = 1+1+4、B = 2+2+2 で数学的には同じ標準化平均だが、
      // z の足し算の誤差で A ≈ -0.26726124191242456、B ≈ -0.2672612419124245 とずれる
      const responses = [
        scored(P, A, 1),
        scored(P, B, 2),
        scored(P, C, 4),
        scored(Q, A, 1),
        scored(Q, B, 2),
        scored(Q, C, 4),
        scored(R, A, 4),
        scored(R, B, 2),
        scored(R, C, 1),
      ];
      const z = computeStandardizedTeamAverages(responses, questions, teams);
      expect(z.get(A)?.zAvg).not.toBe(z.get(B)?.zAvg); // 誤差が実際に出ていること（API の値は丸めない）
      expect([z.get(C)?.zRank, z.get(A)?.zRank, z.get(B)?.zRank]).toEqual([1, 2, 2]);
    });
  });

  describe('withStandardized', () => {
    it('今の順位の並び順を保ったまま zAvg / zRank を付ける', () => {
      const base = aggregateTeamSummaries(example1, questions, teams);
      const result = withStandardized(
        base,
        computeStandardizedTeamAverages(example1, questions, teams),
      );
      expect(result.map((t) => [t.teamName, t.rank, t.zRank])).toEqual([
        ['A', 1, 2],
        ['B', 2, 1],
        ['C', 3, 3],
      ]);
      expect(result[0].avg).toBe(7.5);
      expect(result[1].zAvg).toBeCloseTo(1);
    });
  });
});

describe('computeQuestionDistributions', () => {
  const agree = [{ label: 'ぜひ' }, { label: 'まあ' }, { label: 'うーん' }];

  function res(answers: [number, AggregateResponseInput['answers'][number]['value']][]) {
    return { teamId: 1, answers: answers.map(([questionId, value]) => ({ questionId, value })) };
  }

  it('手計算例: rating（max 3）の範囲外は「その他」、choice の消えた選択肢は「その他」で空文字は数えない', () => {
    const questions = [
      makeQuestion({ id: 1, sortOrder: 1, type: 'rating', maxScore: 3 }),
      makeQuestion({ id: 2, sortOrder: 2, type: 'choice', options: agree, maxScore: null }),
      makeQuestion({ id: 3, sortOrder: 3, type: 'number', maxScore: null }),
    ];
    const responses = [
      res([
        [1, 3],
        [2, 'ぜひ'],
        [3, 100],
      ]),
      res([
        [1, 3],
        [2, 'ぜひ'],
      ]),
      res([
        [1, 1],
        [2, '消えた選択肢'],
      ]),
      res([
        [1, 0],
        [2, ''],
      ]),
      res([]), // その質問に答えていない回答は数えない
    ];
    expect(computeQuestionDistributions(responses, questions)).toEqual([
      {
        questionId: 1,
        buckets: [
          { label: '1', count: 1 },
          { label: '2', count: 0 },
          { label: '3', count: 2 },
        ],
        otherCount: 1,
      },
      {
        questionId: 2,
        buckets: [
          { label: 'ぜひ', count: 2 },
          { label: 'まあ', count: 0 },
          { label: 'うーん', count: 0 },
        ],
        otherCount: 1,
      },
    ]);
  });

  it('rating の maxScore が null なら区分は 1〜5', () => {
    const questions = [makeQuestion({ id: 1, type: 'rating', maxScore: null })];
    const [dist] = computeQuestionDistributions([res([[1, 5]])], questions);
    expect(dist.buckets.map((b) => b.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(dist.buckets[4].count).toBe(1);
    expect(dist.otherCount).toBe(0);
  });

  it('number（maxScore 2）は 0 から数え、小数は「その他」', () => {
    const questions = [makeQuestion({ id: 1, type: 'number', maxScore: 2 })];
    const responses = [res([[1, 0]]), res([[1, 1.5]]), res([[1, 2]])];
    expect(computeQuestionDistributions(responses, questions)).toEqual([
      {
        questionId: 1,
        buckets: [
          { label: '0', count: 1 },
          { label: '1', count: 0 },
          { label: '2', count: 1 },
        ],
        otherCount: 1,
      },
    ]);
  });

  it('text・checkbox の質問は含めず、質問の並び順（sortOrder）で返す', () => {
    const questions = [
      makeQuestion({ id: 1, sortOrder: 3, type: 'rating', maxScore: 5 }),
      makeQuestion({ id: 2, sortOrder: 1, type: 'text', maxScore: null }),
      makeQuestion({ id: 3, sortOrder: 2, type: 'checkbox', options: agree, maxScore: null }),
      makeQuestion({ id: 4, sortOrder: 0, type: 'choice', options: agree, maxScore: null }),
      makeQuestion({ id: 5, sortOrder: 4, type: 'number', maxScore: 21 }), // 上限が 20 を超える
    ];
    const result = computeQuestionDistributions([], questions);
    expect(result.map((d) => d.questionId)).toEqual([4, 1]);
    expect(result[0].otherCount).toBe(0);
  });
});
