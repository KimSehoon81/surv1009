import { describe, expect, it } from 'vitest';
import { enemyScale, globalStep } from '../src/core/scaling';

describe('scaling (PRD §7.3)', () => {
  it('스테이지 1 레벨 1은 모두 1배', () => {
    expect(enemyScale(1, 1)).toEqual({ hp: 1, attack: 1, density: 1, speed: 1 });
  });

  it('스테이지 10 레벨 10 경계값', () => {
    const s = enemyScale(10, 10);
    expect(s.hp).toBeCloseTo((1 + 0.4 * 9) * (1 + 0.06 * 9));
    expect(s.attack).toBeCloseTo(1 + 0.25 * 9);
    expect(s.density).toBeCloseTo(1 + 0.15 * 9);
    expect(s.speed).toBe(1.2);
  });

  it('이동속도 구간: S1~3 1.0, S4~6 1.1, S7~10 1.2', () => {
    expect([1, 3, 4, 6, 7, 10].map((st) => enemyScale(st, 1).speed)).toEqual([1, 1, 1.1, 1.1, 1.2, 1.2]);
  });

  it('레벨당 +6%는 스테이지 배율에 곱해진다', () => {
    expect(enemyScale(2, 5).hp).toBeCloseTo(1.4 * 1.24);
  });

  it('범위 밖 입력은 1~10으로 고정, 위협 등급은 체력·공격에만 곱해짐', () => {
    expect(enemyScale(0, 0)).toEqual(enemyScale(1, 1));
    expect(enemyScale(99, 99)).toEqual(enemyScale(10, 10));
    const t = enemyScale(1, 1, 2);
    expect(t.hp).toBeCloseTo(1.5);
    expect(t.density).toBe(1);
  });

  it('전역 단계 N', () => {
    expect(globalStep(1, 1)).toBe(1);
    expect(globalStep(3, 7)).toBe(27);
    expect(globalStep(10, 10)).toBe(100);
  });
});
