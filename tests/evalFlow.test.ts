import { describe, expect, it } from 'vitest';
import {
  buildAnswerSummary,
  findNextTeamIndex,
  getSubmitMode,
  getTeamStepStatus,
} from '../src/shared/evalFlow';
import type { PublicQuestion } from '../src/shared/types';

const teams = [
  { id: 1, name: 'A班' },
  { id: 2, name: 'B班' },
  { id: 3, name: 'C班' },
  { id: 4, name: 'D班' },
];

function makeQuestion(overrides: Partial<PublicQuestion>): PublicQuestion {
  return {
    id: 1,
    formId: 1,
    sortOrder: 0,
    type: 'rating',
    labelMd: 'Q',
    options: null,
    maxScore: 5,
    required: true,
    scaleLabels: null,
    ...overrides,
  };
}

describe('findNextTeamIndex', () => {
  it('先頭から順に済みの場合、今の次の未回答を返す', () => {
    expect(findNextTeamIndex(teams, new Set([1, 2]), 1)).toBe(2);
  });

  it('今より後ろに未回答がなく前にある場合、前の未回答を返す（折り返し）', () => {
    // 2番目(B班)を飛ばして3・4番目を保存した
    expect(findNextTeamIndex(teams, new Set([1, 3, 4]), 3)).toBe(1);
  });

  it('後ろに未回答があれば、前の未回答より後ろを優先する', () => {
    // 2番目を飛ばして3番目を保存 → 4番目へ（2番目に引き戻さない）
    expect(findNextTeamIndex(teams, new Set([1, 3]), 2)).toBe(3);
  });

  it('全部済みなら -1', () => {
    expect(findNextTeamIndex(teams, new Set([1, 2, 3, 4]), 2)).toBe(-1);
  });

  it('fromIndex = -1 で最初の未回答を返す（再開位置）', () => {
    expect(findNextTeamIndex(teams, new Set([1, 3]), -1)).toBe(1);
    expect(findNextTeamIndex(teams, new Set(), -1)).toBe(0);
  });

  it('completed に teams にない ID が入っていても影響しない', () => {
    expect(findNextTeamIndex(teams, new Set([1, 99]), 0)).toBe(1);
    expect(findNextTeamIndex(teams, new Set([1, 2, 3, 4, 99]), 0)).toBe(-1);
  });
});

describe('getSubmitMode', () => {
  it('未回答が2以上なら next', () => {
    expect(getSubmitMode(teams, new Set([1]), 2)).toBe('next');
  });

  it('未回答が今のチームだけなら finish', () => {
    expect(getSubmitMode(teams, new Set([1, 2, 3]), 4)).toBe('finish');
  });

  it('今のチームが最後の位置でも、他に未回答があれば next', () => {
    expect(getSubmitMode(teams, new Set([1]), 4)).toBe('next');
  });

  it('今のチームが途中の位置でも、他が全部済みなら finish', () => {
    expect(getSubmitMode(teams, new Set([1, 3, 4]), 2)).toBe('finish');
  });

  it('今のチームが済み・他に未回答ありなら edit-next', () => {
    expect(getSubmitMode(teams, new Set([1, 2]), 1)).toBe('edit-next');
  });

  it('今のチームが済み・他も全部済みなら edit-finish', () => {
    expect(getSubmitMode(teams, new Set([1, 2, 3, 4]), 3)).toBe('edit-finish');
  });

  it('チームが 1 つだけなら finish / edit-finish', () => {
    const single = [{ id: 1 }];
    expect(getSubmitMode(single, new Set(), 1)).toBe('finish');
    expect(getSubmitMode(single, new Set([1]), 1)).toBe('edit-finish');
  });

  it('completed に teams 外の ID（相互評価の自チーム）があっても結果が変わらない', () => {
    expect(getSubmitMode(teams, new Set([1, 99]), 2)).toBe('next');
    expect(getSubmitMode(teams, new Set([1, 2, 3, 99]), 4)).toBe('finish');
    expect(getSubmitMode(teams, new Set([1, 2, 3, 4, 99]), 1)).toBe('edit-finish');
  });
});

describe('getTeamStepStatus', () => {
  it('評価中が済みより優先される', () => {
    expect(getTeamStepStatus(2, 1, 1, new Set([2]))).toBe('current');
  });

  it('評価中でなく済みなら done', () => {
    expect(getTeamStepStatus(2, 1, 0, new Set([2]))).toBe('done');
  });

  it('評価中でも済みでもなければ todo', () => {
    expect(getTeamStepStatus(3, 2, 0, new Set([2]))).toBe('todo');
  });
});

describe('buildAnswerSummary', () => {
  const questions: PublicQuestion[] = [
    // view.questions の並びが崩れていても sortOrder 順になること
    makeQuestion({ id: 13, sortOrder: 3, type: 'number', labelMd: '加点', maxScore: 10 }),
    makeQuestion({ id: 11, sortOrder: 1, type: 'text', labelMd: 'コメント', maxScore: null }),
    makeQuestion({ id: 10, sortOrder: 0, type: 'rating', labelMd: '**技術力**', maxScore: 5 }),
    makeQuestion({ id: 14, sortOrder: 4, type: 'number', labelMd: 'おまけ', maxScore: null }),
    makeQuestion({ id: 12, sortOrder: 2, type: 'rating', labelMd: '発表', maxScore: null }),
    makeQuestion({
      id: 15,
      sortOrder: 5,
      type: 'choice',
      labelMd: '選択',
      options: [{ label: 'はい' }],
    }),
    makeQuestion({ id: 16, sortOrder: 6, type: 'checkbox', labelMd: '複数' }),
    makeQuestion({ id: 17, sortOrder: 7, type: 'textarea', labelMd: '感想' }),
  ];

  it('rating と number だけが sortOrder 順に並ぶ', () => {
    const [row] = buildAnswerSummary([teams[0]], questions, {});
    expect(row.items.map((i) => i.questionId)).toEqual([10, 12, 13, 14]);
  });

  it('チームは teams の順に 1 チーム 1 件', () => {
    const rows = buildAnswerSummary(teams, questions, {});
    expect(rows.map((r) => [r.teamId, r.teamName])).toEqual([
      [1, 'A班'],
      [2, 'B班'],
      [3, 'C班'],
      [4, 'D班'],
    ]);
  });

  it('数値の回答は値として、未回答・文字列など数値でない値は null', () => {
    const [row] = buildAnswerSummary([teams[0]], questions, {
      1: { 10: 4, 11: 'よかった', 12: '3', 13: null },
    });
    const byId = Object.fromEntries(row.items.map((i) => [i.questionId, i.value]));
    expect(byId).toEqual({ 10: 4, 12: null, 13: null, 14: null });
  });

  it('rating の max は maxScore ?? 5、number は maxScore（null のまま）', () => {
    const [row] = buildAnswerSummary([teams[0]], questions, {});
    const byId = Object.fromEntries(row.items.map((i) => [i.questionId, i.max]));
    expect(byId).toEqual({ 10: 5, 12: 5, 13: 10, 14: null });
  });

  it('ラベルの Markdown 記号が除かれる', () => {
    const [row] = buildAnswerSummary([teams[0]], questions, {});
    expect(row.items[0].label).toBe('技術力');
    expect(row.items[0].fullLabel).toBe('技術力');
  });

  it('12 文字を超えるラベルは「…」付きで省略され、fullLabel は全文', () => {
    const long = makeQuestion({ id: 20, labelMd: '発表のわかりやすさ（スライド・話し方）' });
    const exact = makeQuestion({ id: 21, sortOrder: 1, labelMd: '一二三四五六七八九十一二' });
    const [row] = buildAnswerSummary([teams[0]], [long, exact], {});
    expect(row.items[0].label).toBe('発表のわかりやすさ（スラ…');
    expect(row.items[0].fullLabel).toBe('発表のわかりやすさ（スライド・話し方）');
    expect(row.items[1].label).toBe('一二三四五六七八九十一二');
  });

  it('ラベルが空になると「質問N」（N は全質問の中での並び順）', () => {
    const qs = [
      makeQuestion({ id: 30, sortOrder: 0, type: 'text', labelMd: 'コメント' }),
      makeQuestion({ id: 31, sortOrder: 1, type: 'rating', labelMd: '**' }),
    ];
    const [row] = buildAnswerSummary([teams[0]], qs, {});
    expect(row.items[0].label).toBe('質問2');
    expect(row.items[0].fullLabel).toBe('質問2');
  });

  it('質問が空なら items も空', () => {
    const [row] = buildAnswerSummary([teams[0]], [], { 1: { 10: 5 } });
    expect(row.items).toEqual([]);
  });

  it('回答が 1 件もないチームも行が出て、値がすべて null', () => {
    const rows = buildAnswerSummary(teams, questions, { 1: { 10: 5 } });
    expect(rows).toHaveLength(4);
    expect(rows[1].items.every((i) => i.value === null)).toBe(true);
  });
});
