import { describe, expect, it } from 'vitest';
import { createRng, fromState, hashString, normalizeSeed } from '../src/core/rng';

const sample = (seed: number | string, n: number) => {
  const r = createRng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('rng', () => {
  it('같은 시드는 같은 수열, 다른 시드는 다른 수열', () => {
    expect(sample(42, 20)).toEqual(sample(42, 20));
    expect(sample(42, 20)).not.toEqual(sample(43, 20));
    expect(sample('stage1', 5)).toEqual(sample('stage1', 5));
    expect(normalizeSeed('stage1')).toBe(hashString('stage1'));
  });

  it('next는 [0,1) 범위이고 평균이 0.5 근처', () => {
    const xs = sample(7, 20_000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });

  it('int는 양 끝을 포함하고 고르게 나온다', () => {
    const r = createRng(1);
    const counts = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const v = r.int(1, 6);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const c of counts.values()) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it('chance(0.3)은 10,000회에서 30%±1% (카드 판정 기준)', () => {
    const r = createRng('card-judge');
    let hit = 0;
    for (let i = 0; i < 10_000; i++) if (r.chance(0.3)) hit++;
    expect(hit / 10_000).toBeGreaterThan(0.29);
    expect(hit / 10_000).toBeLessThan(0.31);
  });

  it('chance 경계값은 난수를 소모하지 않는다', () => {
    const r = createRng(5);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
    expect(r.getState().cursor).toBe(0);
  });

  it('weighted는 가중치 비례, 0 가중치는 나오지 않음', () => {
    const r = createRng(9);
    const items = [
      { id: 'common', w: 60 },
      { id: 'rare', w: 30 },
      { id: 'never', w: 0 },
      { id: 'legend', w: 10 },
    ];
    const counts: Record<string, number> = {};
    for (let i = 0; i < 20_000; i++) {
      const it = r.weighted(items, (x) => x.w);
      counts[it.id] = (counts[it.id] ?? 0) + 1;
    }
    expect(counts.never).toBeUndefined();
    expect((counts.common ?? 0) / 20_000).toBeCloseTo(0.6, 1);
    expect((counts.legend ?? 0) / 20_000).toBeCloseTo(0.1, 1);
    expect(() => r.weighted(items, () => 0)).toThrow();
  });

  it('pick·shuffle: 원본 불변, 순열 유지, 빈 배열 오류', () => {
    const r = createRng(3);
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = r.shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((a, b) => a - b)).toEqual(src);
    expect(src).toContain(r.pick(src));
    expect(() => r.pick([])).toThrow();
  });

  it('fork는 부모의 소비량과 무관하게 (시드, 이름)으로 결정된다', () => {
    const a = createRng(100);
    const b = createRng(100);
    for (let i = 0; i < 50; i++) b.next();
    expect(a.fork('spawn').next()).toBe(b.fork('spawn').next());
    expect(a.fork('spawn').next()).not.toBe(a.fork('cards').next());
    expect(a.fork('spawn').next()).not.toBe(a.next());
  });

  it('getState/fromState로 중간 지점부터 같은 수열을 이어간다', () => {
    const r = createRng(77);
    for (let i = 0; i < 123; i++) r.next();
    const saved = r.getState();
    const expected = [r.next(), r.next(), r.next()];
    const restored = fromState(saved);
    expect([restored.next(), restored.next(), restored.next()]).toEqual(expected);
  });
});
