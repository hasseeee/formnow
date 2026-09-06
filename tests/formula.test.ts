import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/worker/logic/formula';

describe('formula.evaluate', () => {
  it('数値リテラルを評価できる', () => {
    expect(evaluate('42', {})).toBe(42);
    expect(evaluate('3.5', {})).toBe(3.5);
  });

  it('四則演算ができる', () => {
    expect(evaluate('1 + 2', {})).toBe(3);
    expect(evaluate('5 - 2', {})).toBe(3);
    expect(evaluate('4 * 3', {})).toBe(12);
    expect(evaluate('10 / 4', {})).toBe(2.5);
  });

  it('演算子の優先順位が正しい (* / が + - より優先)', () => {
    expect(evaluate('2 + 3 * 4', {})).toBe(14);
    expect(evaluate('2 * 3 + 4', {})).toBe(10);
    expect(evaluate('10 - 4 / 2', {})).toBe(8);
    expect(evaluate('2 + 6 / 3 - 1', {})).toBe(3);
  });

  it('括弧で優先順位を変更できる', () => {
    expect(evaluate('(2 + 3) * 4', {})).toBe(20);
    expect(evaluate('((1 + 2) * (3 + 4))', {})).toBe(21);
    expect(evaluate('10 / (2 + 3)', {})).toBe(2);
  });

  it('単項マイナスを扱える', () => {
    expect(evaluate('-5', {})).toBe(-5);
    expect(evaluate('-5 + 3', {})).toBe(-2);
    expect(evaluate('3 - -2', {})).toBe(5);
    expect(evaluate('-(2 + 3)', {})).toBe(-5);
    expect(evaluate('--5', {})).toBe(5);
  });

  it('単項プラスも扱える', () => {
    expect(evaluate('+5', {})).toBe(5);
    expect(evaluate('3 + +2', {})).toBe(5);
  });

  it('ハイフン付きの変数名を解決できる', () => {
    const vars = {
      'judge-form_avg': 80,
      'peer-form_sum': 150,
      'my-team-form_count': 3,
    };
    expect(evaluate('judge-form_avg', vars)).toBe(80);
    expect(evaluate('judge-form_avg + peer-form_sum', vars)).toBe(230);
    expect(evaluate('peer-form_sum / my-team-form_count', vars)).toBe(50);
  });

  it('変数を使った複雑な式を評価できる', () => {
    const vars = { judge_avg: 70, peer_avg: 30 };
    expect(evaluate('judge_avg * 0.7 + peer_avg * 0.3', vars)).toBeCloseTo(58, 8);
  });

  it('空白を無視する', () => {
    expect(evaluate('  1   +   2  ', {})).toBe(3);
  });

  it('未知の変数はエラーになる', () => {
    expect(() => evaluate('unknown_var', {})).toThrow(/不明な変数/);
  });

  it('ゼロ除算はエラーになる', () => {
    expect(() => evaluate('1 / 0', {})).toThrow(/ゼロ除算/);
  });

  it('括弧の対応が取れていない場合はエラーになる', () => {
    expect(() => evaluate('(1 + 2', {})).toThrow();
    expect(() => evaluate('1 + 2)', {})).toThrow();
  });

  it('構文エラーを検出する', () => {
    expect(() => evaluate('1 +', {})).toThrow();
    expect(() => evaluate('* 1', {})).toThrow();
    expect(() => evaluate('1 2', {})).toThrow();
    expect(() => evaluate('', {})).toThrow();
  });

  it('不正な文字はエラーになる', () => {
    expect(() => evaluate('1 & 2', {})).toThrow(/不正な文字/);
  });
});
