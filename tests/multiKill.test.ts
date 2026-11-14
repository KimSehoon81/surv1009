import { describe, expect, it } from 'vitest';
import feelData from '../src/data/feel.json';
import { killCenter, newMultiKill, registerKill } from '../src/core/multiKill';

const cfg = { windowMs: 160, tiers: [4, 8, 14] };

describe('다중 처치', () => {
  it('이어진 처치가 단계에 딱 닿는 순간만 알림', () => {
    const s = newMultiKill();
    const got: number[] = [];
    for (let i = 0; i < 15; i++) got.push(registerKill(s, 1000 + i * 10, i, 0, cfg));
    expect(got).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 3, 0]);
  });

  it('간격이 벌어지면 새 묶음', () => {
    const s = newMultiKill();
    for (let i = 0; i < 3; i++) expect(registerKill(s, i * 10, 0, 0, cfg)).toBe(0);
    expect(registerKill(s, 20 + 161, 0, 0, cfg)).toBe(0);
    expect(s.count).toBe(1);
    // 창 안에서 계속 이어지면 오래 걸려도 한 묶음
    for (let i = 0; i < 2; i++) registerKill(s, 181 + (i + 1) * 150, 0, 0, cfg);
    expect(registerKill(s, 181 + 3 * 150, 0, 0, cfg)).toBe(1);
  });

  it('가운데는 묶음 처치 자리의 평균', () => {
    const s = newMultiKill();
    registerKill(s, 0, 10, 20, cfg);
    registerKill(s, 5, 30, 40, cfg);
    expect(killCenter(s)).toEqual({ x: 20, y: 30 });
  });

  it('데이터: 단계마다 프리셋과 숫자 스타일이 있음', () => {
    const m = feelData.multiKill;
    expect(m.presets).toHaveLength(m.tiers.length);
    for (const p of m.presets) expect((feelData.presets as Record<string, { number?: string }>)[p]?.number).toBe('multi');
    expect((feelData.numbers.styles as Record<string, unknown>).multi).toBeDefined();
    expect([...m.tiers].sort((a, b) => a - b)).toEqual(m.tiers);
  });
});
