import { describe, expect, it } from 'vitest';
import combat from '../src/data/combat.json';
import { blockChance, computeHit } from '../src/core/combat';
import { createRng } from '../src/core/rng';

const base = { attack: 10, critChance: 0, critMult: 2, defense: 0, blockK: combat.blockK, blockReduction: combat.blockReduction, maxBlockChance: combat.maxBlockChance };

describe('combat (PRD §4.1·§4.3)', () => {
  it('기본 피해, 최소 1', () => {
    const rng = createRng(1);
    expect(computeHit(base, rng)).toEqual({ damage: 10, crit: false, blocked: false });
    expect(computeHit({ ...base, attack: 0.2 }, rng).damage).toBe(1);
  });

  it('치명타 5%·×2.0: 20,000회에서 비율 5%±0.5%, 치명 피해는 2배', () => {
    const rng = createRng('crit');
    let crits = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = computeHit({ ...base, critChance: 0.05 }, rng);
      if (r.crit) {
        crits++;
        expect(r.damage).toBe(20);
      } else expect(r.damage).toBe(10);
    }
    expect(crits / 20_000).toBeGreaterThan(0.045);
    expect(crits / 20_000).toBeLessThan(0.055);
  });

  it('방어 확률 = 방어력/(방어력+K), 상한, 방어력 0이면 0', () => {
    expect(blockChance(0, 30, 0.6)).toBe(0);
    expect(blockChance(30, 30, 0.6)).toBeCloseTo(0.5);
    expect(blockChance(1000, 30, 0.6)).toBe(0.6);
    expect(blockChance(5, 30, 0.6)).toBeLessThan(blockChance(14, 30, 0.6)); // 소총수 < 방호병
  });

  it('방어 성공 시 피해 −50%, 실측 방어율이 공식과 일치', () => {
    const rng = createRng('block');
    let blocks = 0;
    for (let i = 0; i < 20_000; i++) {
      const r = computeHit({ ...base, attack: 10, defense: 14 }, rng);
      if (r.blocked) {
        blocks++;
        expect(r.damage).toBe(5);
      }
    }
    expect(blocks / 20_000).toBeCloseTo(blockChance(14, combat.blockK, combat.maxBlockChance), 1);
  });

  it('같은 시드면 같은 결과(재현성)', () => {
    const a = createRng('x');
    const b = createRng('x');
    for (let i = 0; i < 50; i++) expect(computeHit({ ...base, critChance: 0.3, defense: 10 }, a)).toEqual(computeHit({ ...base, critChance: 0.3, defense: 10 }, b));
  });
});
