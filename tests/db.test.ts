import { describe, expect, it } from 'vitest';
import { planMergeUpsert, type MergeExistingRow, type MergeItemInput } from '../src/worker/db';

describe('planMergeUpsert', () => {
  it('idが指定され既存に存在すれば更新する', () => {
    const existing: MergeExistingRow[] = [{ id: 1, matchKey: 'A' }];
    const items: MergeItemInput<{ v: string }>[] = [{ id: 1, matchKey: 'A', data: { v: 'A2' } }];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([{ action: 'update', id: 1, data: { v: 'A2' } }]);
  });

  it('id無しでも同名の既存行があれば更新扱いにする', () => {
    const existing: MergeExistingRow[] = [{ id: 1, matchKey: 'チームA' }];
    const items: MergeItemInput<{ v: string }>[] = [{ matchKey: 'チームA', data: { v: 'updated' } }];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([{ action: 'update', id: 1, data: { v: 'updated' } }]);
  });

  it('一致する既存行が無ければ追加する', () => {
    const existing: MergeExistingRow[] = [{ id: 1, matchKey: 'チームA' }];
    const items: MergeItemInput<{ v: string }>[] = [{ matchKey: 'チームB', data: { v: 'new' } }];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([{ action: 'insert', data: { v: 'new' } }]);
  });

  it('items に含まれない既存行はプランに現れない (削除されない)', () => {
    const existing: MergeExistingRow[] = [
      { id: 1, matchKey: 'A' },
      { id: 2, matchKey: 'B' },
    ];
    // B に触れず A のみ更新する
    const items: MergeItemInput<{ v: string }>[] = [{ id: 1, matchKey: 'A', data: { v: 'A2' } }];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([{ action: 'update', id: 1, data: { v: 'A2' } }]);
    // id=2 に対する delete/update は一切生成されない
    expect(plan.some((p) => p.action === 'update' && p.id === 2)).toBe(false);
  });

  it('存在しないidが指定された場合、matchKeyで解決を試みる', () => {
    const existing: MergeExistingRow[] = [{ id: 5, matchKey: 'チームA' }];
    const items: MergeItemInput<{ v: string }>[] = [{ id: 999, matchKey: 'チームA', data: { v: 'x' } }];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([{ action: 'update', id: 5, data: { v: 'x' } }]);
  });

  it('存在しないid・matchKeyも不一致なら追加する', () => {
    const existing: MergeExistingRow[] = [{ id: 5, matchKey: 'チームA' }];
    const items: MergeItemInput<{ v: string }>[] = [{ id: 999, matchKey: 'チームZ', data: { v: 'x' } }];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([{ action: 'insert', data: { v: 'x' } }]);
  });

  it('同名の既存行が複数あっても1件ずつ順に消費する (二重解決しない)', () => {
    const existing: MergeExistingRow[] = [
      { id: 1, matchKey: 'X' },
      { id: 2, matchKey: 'X' },
    ];
    const items: MergeItemInput<{ v: string }>[] = [
      { matchKey: 'X', data: { v: 'first' } },
      { matchKey: 'X', data: { v: 'second' } },
    ];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([
      { action: 'update', id: 1, data: { v: 'first' } },
      { action: 'update', id: 2, data: { v: 'second' } },
    ]);
  });

  it('複数itemが同じ既存idを奪い合わない (2件目以降は追加になる)', () => {
    const existing: MergeExistingRow[] = [{ id: 1, matchKey: 'X' }];
    const items: MergeItemInput<{ v: string }>[] = [
      { id: 1, matchKey: 'X', data: { v: 'first' } },
      { matchKey: 'X', data: { v: 'second' } },
    ];
    const plan = planMergeUpsert(existing, items);
    expect(plan).toEqual([
      { action: 'update', id: 1, data: { v: 'first' } },
      { action: 'insert', data: { v: 'second' } },
    ]);
  });

  it('空のitemsは空プランになる (既存行は一切変更されない)', () => {
    const existing: MergeExistingRow[] = [{ id: 1, matchKey: 'A' }];
    const plan = planMergeUpsert(existing, []);
    expect(plan).toEqual([]);
  });
});
