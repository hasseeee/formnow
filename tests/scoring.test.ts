import { describe, expect, it } from 'vitest';
import { isScorable, maxPossibleScore, numericValue, responseScore } from '../src/worker/logic/scoring';
import type { Question } from '../src/shared/types';

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 1,
    formId: 1,
    sortOrder: 0,
    type: 'rating',
    labelMd: 'Q',
    options: null,
    maxScore: null,
    weight: 1,
    required: true,
    ...overrides,
  };
}

describe('isScorable', () => {
  it('rating/number は常に採点対象', () => {
    expect(isScorable(makeQuestion({ type: 'rating' }))).toBe(true);
    expect(isScorable(makeQuestion({ type: 'number' }))).toBe(true);
  });

  it('text/textarea は常に採点対象外', () => {
    expect(isScorable(makeQuestion({ type: 'text' }))).toBe(false);
    expect(isScorable(makeQuestion({ type: 'textarea' }))).toBe(false);
  });

  it('choice/checkbox はscoreを持つ選択肢が1つもなければ採点対象外', () => {
    expect(isScorable(makeQuestion({ type: 'choice', options: [{ label: 'A' }, { label: 'B' }] }))).toBe(false);
    expect(isScorable(makeQuestion({ type: 'checkbox', options: [{ label: 'A' }] }))).toBe(false);
    expect(isScorable(makeQuestion({ type: 'choice', options: null }))).toBe(false);
  });

  it('choice/checkbox はscoreを持つ選択肢が1つでもあれば採点対象', () => {
    expect(
      isScorable(makeQuestion({ type: 'choice', options: [{ label: 'A' }, { label: 'B', score: 5 }] }))
    ).toBe(true);
    expect(isScorable(makeQuestion({ type: 'checkbox', options: [{ label: 'A', score: 0 }] }))).toBe(true);
  });
});

describe('numericValue', () => {
  it('rating/number はそのまま数値を返す', () => {
    expect(numericValue(makeQuestion({ type: 'rating' }), 4)).toBe(4);
    expect(numericValue(makeQuestion({ type: 'number' }), 12.5)).toBe(12.5);
  });

  it('choice は選択肢の score を返す', () => {
    const q = makeQuestion({
      type: 'choice',
      options: [
        { label: 'A', score: 10 },
        { label: 'B', score: 5 },
      ],
    });
    expect(numericValue(q, 'A')).toBe(10);
    expect(numericValue(q, 'B')).toBe(5);
  });

  it('choice で score が無い選択肢は0を返す', () => {
    const q = makeQuestion({ type: 'choice', options: [{ label: 'A' }] });
    expect(numericValue(q, 'A')).toBe(0);
  });

  it('choice で一致する選択肢が無ければnullを返す (採点除外)', () => {
    const q = makeQuestion({ type: 'choice', options: [{ label: 'A', score: 10 }] });
    expect(numericValue(q, 'unknown')).toBeNull();
  });

  it('checkbox は選択したoptionsのscore合計を返す', () => {
    const q = makeQuestion({
      type: 'checkbox',
      options: [
        { label: 'A', score: 3 },
        { label: 'B', score: 4 },
        { label: 'C', score: 5 },
      ],
    });
    expect(numericValue(q, ['A', 'C'])).toBe(8);
    expect(numericValue(q, [])).toBe(0);
    expect(numericValue(q, ['A', 'unknown'])).toBe(3);
  });

  it('text/textarea は採点対象外(null)を返す', () => {
    expect(numericValue(makeQuestion({ type: 'text' }), 'hello')).toBeNull();
    expect(numericValue(makeQuestion({ type: 'textarea' }), 'hello')).toBeNull();
  });
});

describe('responseScore', () => {
  it('Σ(数値化した回答値 × weight) を計算する', () => {
    const questions: Question[] = [
      makeQuestion({ id: 1, type: 'rating', weight: 2 }),
      makeQuestion({ id: 2, type: 'number', weight: 1 }),
      makeQuestion({
        id: 3,
        type: 'choice',
        weight: 3,
        options: [{ label: 'good', score: 5 }],
      }),
      makeQuestion({ id: 4, type: 'text', weight: 1 }),
    ];
    const answers = [
      { questionId: 1, value: 4 }, // 4*2=8
      { questionId: 2, value: 10 }, // 10*1=10
      { questionId: 3, value: 'good' }, // 5*3=15
      { questionId: 4, value: '自由記述' }, // 対象外
    ];
    expect(responseScore(questions, answers)).toBe(33);
  });

  it('存在しない質問IDの回答は無視する', () => {
    const questions: Question[] = [makeQuestion({ id: 1, type: 'rating', weight: 1 })];
    const answers = [
      { questionId: 1, value: 3 },
      { questionId: 999, value: 100 },
    ];
    expect(responseScore(questions, answers)).toBe(3);
  });
});

describe('maxPossibleScore', () => {
  it('rating/number は maxScore × weight', () => {
    const questions: Question[] = [
      makeQuestion({ id: 1, type: 'rating', maxScore: 5, weight: 2 }),
      makeQuestion({ id: 2, type: 'number', maxScore: 100, weight: 1 }),
    ];
    expect(maxPossibleScore(questions)).toBe(5 * 2 + 100 * 1);
  });

  it('choice は最大scoreの選択肢 × weight', () => {
    const questions: Question[] = [
      makeQuestion({
        id: 1,
        type: 'choice',
        weight: 2,
        options: [
          { label: 'A', score: 3 },
          { label: 'B', score: 7 },
        ],
      }),
    ];
    expect(maxPossibleScore(questions)).toBe(14);
  });

  it('checkbox は全選択肢のscore合計 × weight', () => {
    const questions: Question[] = [
      makeQuestion({
        id: 1,
        type: 'checkbox',
        weight: 2,
        options: [
          { label: 'A', score: 3 },
          { label: 'B', score: 4 },
        ],
      }),
    ];
    expect(maxPossibleScore(questions)).toBe(14);
  });

  it('text/textarea は0として扱う', () => {
    const questions: Question[] = [makeQuestion({ id: 1, type: 'text' }), makeQuestion({ id: 2, type: 'textarea' })];
    expect(maxPossibleScore(questions)).toBe(0);
  });

  it('複数質問の合計を計算する', () => {
    const questions: Question[] = [
      makeQuestion({ id: 1, type: 'rating', maxScore: 5, weight: 1 }),
      makeQuestion({
        id: 2,
        type: 'choice',
        weight: 1,
        options: [{ label: 'A', score: 10 }],
      }),
      makeQuestion({ id: 3, type: 'text' }),
    ];
    expect(maxPossibleScore(questions)).toBe(15);
  });
});
