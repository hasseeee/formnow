import { describe, expect, it } from 'vitest';
import {
  normalizeScaleLabels,
  resizeScaleLabels,
  SCALE_LABEL_MAX_LENGTH,
  SCALE_LABELS_MAX_STEPS,
} from '../src/shared/scaleLabels';

describe('定数', () => {
  it('説明は40文字まで、段階は100まで', () => {
    expect(SCALE_LABEL_MAX_LENGTH).toBe(40);
    expect(SCALE_LABELS_MAX_STEPS).toBe(100);
  });
});

describe('normalizeScaleLabels', () => {
  it('undefined / null は説明なし', () => {
    expect(normalizeScaleLabels({ type: 'rating', maxScore: 5 })).toEqual({
      ok: true,
      value: null,
    });
    expect(normalizeScaleLabels({ type: 'rating', maxScore: 5, scaleLabels: null })).toEqual({
      ok: true,
      value: null,
    });
  });

  it('すべて空白の配列は説明なし（rating 以外の型でも ok）', () => {
    expect(
      normalizeScaleLabels({ type: 'rating', maxScore: 3, scaleLabels: ['', '  ', ''] }),
    ).toEqual({ ok: true, value: null });
    expect(
      normalizeScaleLabels({ type: 'textarea', maxScore: null, scaleLabels: [' ', ''] }),
    ).toEqual({ ok: true, value: null });
  });

  it('前後の空白を trim して返す', () => {
    expect(
      normalizeScaleLabels({ type: 'rating', maxScore: 3, scaleLabels: ['  もう少し ', ' ', 'よい'] }),
    ).toEqual({ ok: true, value: ['もう少し', '', 'よい'] });
  });

  it('rating 以外に空でない説明を付けるとエラー', () => {
    const r = normalizeScaleLabels({ type: 'number', maxScore: 3, scaleLabels: ['a', '', 'c'] });
    expect(r).toEqual({ ok: false, error: 'scaleLabels は評価（rating）の質問にだけ付けられます' });
  });

  it.each([null, 4.5, 0, 101])('maxScore が %s ならエラー', (maxScore) => {
    const r = normalizeScaleLabels({ type: 'rating', maxScore, scaleLabels: ['a'] });
    expect(r).toEqual({
      ok: false,
      error: 'scaleLabels を付けるには maxScore を 1〜100 の整数にしてください',
    });
  });

  it('長さが maxScore と違うとエラー（両方の数がメッセージに入る）', () => {
    const r = normalizeScaleLabels({ type: 'rating', maxScore: 5, scaleLabels: ['a', '', 'c'] });
    expect(r).toEqual({ ok: false, error: 'scaleLabels の数（3）が maxScore（5）と一致しません' });
  });

  it('正しい配列はそのまま返す', () => {
    const labels = ['もう少し', '', '', '', 'とてもよい'];
    expect(normalizeScaleLabels({ type: 'rating', maxScore: 5, scaleLabels: labels })).toEqual({
      ok: true,
      value: labels,
    });
  });
});

describe('resizeScaleLabels', () => {
  const five = ['もう少し', 'やや物足りない', 'ふつう', 'よい', 'とてもよい'];

  it('null は null', () => {
    expect(resizeScaleLabels(null, 5)).toBeNull();
  });

  it('同じ長さなら同じ配列を返す', () => {
    expect(resizeScaleLabels(five, 5)).toBe(five);
  });

  it('5→10: 両端が残り、途中は空', () => {
    expect(resizeScaleLabels(five, 10)).toEqual([
      'もう少し',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'とてもよい',
    ]);
  });

  it('10→5: 両端が残り、途中は空', () => {
    const ten = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(resizeScaleLabels(ten, 5)).toEqual(['a', '', '', '', 'j']);
  });

  it('長さ1→5: 先頭だけ残り、末尾に先頭はコピーされない', () => {
    expect(resizeScaleLabels(['ひとつ'], 5)).toEqual(['ひとつ', '', '', '', '']);
  });

  it.each([null, 4.5, 101])('newMax が %s なら null', (newMax) => {
    expect(resizeScaleLabels(five, newMax)).toBeNull();
  });

  it('結果が全部空なら null', () => {
    expect(resizeScaleLabels(['', 'ふつう', ''], 5)).toBeNull();
  });
});
