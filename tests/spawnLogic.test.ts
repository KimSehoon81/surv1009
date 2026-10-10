import { describe, expect, it } from 'vitest';
import { accumulate, ringPoint, spawnRadius } from '../src/core/spawnLogic';

describe('spawnLogic', () => {
  it('초당 2마리를 16ms씩 1초 누적하면 정확히 2마리', () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 1000 / 16; i++) {
      const r = accumulate(acc, 2, 16);
      acc = r.acc;
      total += r.count;
    }
    expect(total + Math.round(acc)).toBe(2);
  });

  it('큰 delta에서도 개수 보존, 음수 속도는 0', () => {
    expect(accumulate(0.5, 3, 1000)).toEqual({ count: 3, acc: 0.5 });
    expect(accumulate(0, -1, 1000).count).toBe(0);
  });

  it('스폰 반지름은 화면 대각선 반 + 여유, 원 위의 점', () => {
    expect(spawnRadius(960, 540, 0)).toBeCloseTo(Math.hypot(480, 270));
    const p = ringPoint(10, 20, 100, Math.PI / 2);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(120);
  });
});
