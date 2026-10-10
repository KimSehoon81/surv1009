import { describe, expect, it } from 'vitest';
import { oldestPair, pickupScale } from '../src/core/pickupMerge';

describe('pickupMerge', () => {
  it('가장 오래된 것과 두 번째로 오래된 것', () => {
    const items = [{ bornMs: 50, value: 1 }, { bornMs: 10, value: 1 }, { bornMs: 30, value: 2 }, { bornMs: 20, value: 1 }];
    expect(oldestPair(items)).toEqual({ remove: 1, into: 3 });
    expect(oldestPair([{ bornMs: 5, value: 1 }, { bornMs: 1, value: 1 }])).toEqual({ remove: 1, into: 0 });
    expect(oldestPair([{ bornMs: 1, value: 1 }])).toBeNull();
  });

  it('값이 클수록 조금 크게, 상한 2배', () => {
    expect(pickupScale(1, 0.5)).toBe(0.5);
    expect(pickupScale(8, 0.5)).toBeGreaterThan(pickupScale(2, 0.5));
    expect(pickupScale(1e9, 0.5)).toBe(1);
  });
});
