import { describe, expect, it } from 'vitest';
import { timingSafeEqual } from '../src/worker/logic/security';

describe('timingSafeEqual', () => {
  it('同じ文字列はtrueを返す', () => {
    expect(timingSafeEqual('secret-token', 'secret-token')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('異なる文字列はfalseを返す', () => {
    expect(timingSafeEqual('secret-token', 'wrong-token1')).toBe(false);
  });

  it('長さが異なる文字列はfalseを返す', () => {
    expect(timingSafeEqual('short', 'much-longer-string')).toBe(false);
    expect(timingSafeEqual('abc', '')).toBe(false);
  });

  it('末尾だけ異なる文字列もfalseを返す', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });
});
