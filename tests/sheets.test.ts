import { describe, expect, it } from 'vitest';
import {
  base64UrlEncodeString,
  buildJwtSigningInput,
  buildResponseDataRow,
  buildResponseHeaderRow,
  buildSummarySheetRows,
  escapeSheetName,
  pemToArrayBuffer,
  responseTabName,
  summaryTabName,
} from '../src/worker/sheets';
import type { Question } from '../src/shared/types';

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 1,
    formId: 1,
    sortOrder: 0,
    type: 'rating',
    labelMd: 'Q',
    options: null,
    maxScore: 10,
    weight: 1,
    required: true,
    ...overrides,
  };
}

describe('escapeSheetName', () => {
  it('シート名をシングルクォートで囲む', () => {
    expect(escapeSheetName('lt-judge_回答')).toBe("'lt-judge_回答'");
  });

  it('内部のシングルクォートは二重化する', () => {
    expect(escapeSheetName("O'Brien")).toBe("'O''Brien'");
  });
});

describe('responseTabName / summaryTabName', () => {
  it('slugにサフィックスを付与する', () => {
    expect(responseTabName('lt-judge')).toBe('lt-judge_回答');
    expect(summaryTabName('lt-judge')).toBe('lt-judge_集計');
  });
});

describe('pemToArrayBuffer', () => {
  it('PEMヘッダ・フッタ・改行を除去してbase64デコードする', () => {
    // "hello" の base64 は "aGVsbG8="
    const pem = '-----BEGIN PRIVATE KEY-----\naGVsbG8=\n-----END PRIVATE KEY-----\n';
    const buf = pemToArrayBuffer(pem);
    const text = new TextDecoder().decode(buf);
    expect(text).toBe('hello');
  });
});

describe('base64UrlEncodeString', () => {
  it('base64url形式でエンコードする (パディング無し, +/ を -_ に置換)', () => {
    // 通常のbase64だと "+" "/" "=" を含みうる文字列で確認
    expect(base64UrlEncodeString('hello')).toBe('aGVsbG8');
    expect(base64UrlEncodeString('>>>???')).not.toMatch(/[+/=]/);
  });
});

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return atob(base64);
}

describe('buildJwtSigningInput', () => {
  it('header.payload の base64url を "." で結合する', () => {
    const result = buildJwtSigningInput('svc@example.iam.gserviceaccount.com', 'scope-a', 1700000000);
    const parts = result.split('.');
    expect(parts).toHaveLength(2);
    const header = JSON.parse(decodeBase64Url(parts[0]));
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toEqual({
      iss: 'svc@example.iam.gserviceaccount.com',
      scope: 'scope-a',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1700000000,
      exp: 1700003600,
    });
  });
});

describe('buildResponseHeaderRow / buildResponseDataRow', () => {
  const questions: Question[] = [
    makeQuestion({ id: 1, labelMd: '**技術力**', type: 'rating', maxScore: 10, weight: 2 }),
    makeQuestion({ id: 2, labelMd: '感想', type: 'textarea', maxScore: null, weight: 1 }),
  ];

  it('ヘッダー行はMarkdownを平文化したラベルを含む', () => {
    expect(buildResponseHeaderRow(questions)).toEqual(['回答者', 'チーム', '送信日時', '技術力', '感想', '合計スコア']);
  });

  it('データ行は回答値とスコアを含む', () => {
    const row = buildResponseDataRow(questions, {
      respondentName: '審査員A',
      teamName: 'チームX',
      submittedAt: '2026-09-07 12:00:00',
      answers: [
        { questionId: 1, value: 8 },
        { questionId: 2, value: '良かったです' },
      ],
    });
    expect(row).toEqual(['審査員A', 'チームX', '2026-09-07 12:00:00', 8, '良かったです', 16]);
  });

  it('未回答の質問は空文字にする', () => {
    const row = buildResponseDataRow(questions, {
      respondentName: '審査員B',
      teamName: 'チームY',
      submittedAt: '2026-09-07 12:00:00',
      answers: [{ questionId: 1, value: 5 }],
    });
    expect(row).toEqual(['審査員B', 'チームY', '2026-09-07 12:00:00', 5, '', 10]);
  });
});

describe('buildSummarySheetRows', () => {
  const scoredQuestions: Question[] = [makeQuestion({ id: 1, labelMd: '技術力' })];

  it('チーム集計のみの場合は集計行だけを返す', () => {
    const rows = buildSummarySheetRows(
      [
        { rank: 1, teamName: 'チームA', count: 2, sum: 18, avg: 9, questionAvgs: { 1: 9 } },
        { rank: 2, teamName: 'チームB', count: 1, sum: 5, avg: 5, questionAvgs: { 1: 5 } },
      ],
      scoredQuestions,
      []
    );
    expect(rows).toEqual([
      ['順位', 'チーム', '回答数', '平均', '合計', '技術力'],
      [1, 'チームA', 2, 9, 18, 9],
      [2, 'チームB', 1, 5, 5, 5],
    ]);
  });

  it('計算式がある場合は空行を挟んでランキングを追加する', () => {
    const rows = buildSummarySheetRows(
      [{ rank: 1, teamName: 'チームA', count: 1, sum: 10, avg: 10, questionAvgs: { 1: 10 } }],
      scoredQuestions,
      [
        {
          name: '最終順位',
          ranking: [
            { teamName: 'チームA', value: 7, rank: 1 },
            { teamName: 'チームB', value: null, rank: null },
          ],
        },
      ]
    );
    expect(rows).toEqual([
      ['順位', 'チーム', '回答数', '平均', '合計', '技術力'],
      [1, 'チームA', 1, 10, 10, 10],
      [],
      ['計算式: 最終順位'],
      ['順位', 'チーム', '値'],
      [1, 'チームA', 7],
      ['', 'チームB', ''],
    ]);
  });

  it('回答数0のチームはavg/rankが空文字になる', () => {
    const rows = buildSummarySheetRows(
      [{ rank: null, teamName: 'チームC', count: 0, sum: 0, avg: null, questionAvgs: {} }],
      scoredQuestions,
      []
    );
    expect(rows).toEqual([
      ['順位', 'チーム', '回答数', '平均', '合計', '技術力'],
      ['', 'チームC', 0, '', 0, ''],
    ]);
  });
});
