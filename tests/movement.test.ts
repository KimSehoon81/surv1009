import { describe, expect, it } from 'vitest';
import { facingFrom, normalizeAxis, step } from '../src/core/movement';

describe('movement', () => {
  it('대각선 입력도 길이 1(대각선이 빨라지지 않음)', () => {
    const d = normalizeAxis(1, 1);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(normalizeAxis(0, 0)).toEqual({ x: 0, y: 0 });
    expect(normalizeAxis(-1, 0)).toEqual({ x: -1, y: 0 });
  });

  it('속도(px/초)와 경과 시간으로 이동', () => {
    expect(step({ x: 0, y: 0 }, { x: 1, y: 0 }, 120, 500)).toEqual({ x: 60, y: 0 });
    expect(step({ x: 5, y: 5 }, { x: 0, y: -1 }, 100, 0)).toEqual({ x: 5, y: 5 });
  });

  it('가로 입력이 없으면 바라보는 방향 유지', () => {
    expect(facingFrom(1, -1)).toBe(1);
    expect(facingFrom(-0.7, 1)).toBe(-1);
    expect(facingFrom(0, -1)).toBe(-1);
  });
});
