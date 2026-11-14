import { describe, expect, it } from 'vitest';
import combat from '../src/data/combat.json';
import enemiesData from '../src/data/enemies.json';
import { canSprint, enemySprintMul, enemySprintPhase, nextSprintSec, pickSprinters, type EnemySprintConfig } from '../src/core/enemySprint';
import { createRng } from '../src/core/rng';

const CFG = combat.enemySprint as unknown as EnemySprintConfig;
type Def = { tier?: string; air?: boolean; behaviors?: { type: string }[] };
const EN = enemiesData.enemies as unknown as Record<string, Def>;

describe('적 질주', () => {
  it('예고(느려짐) → 질주(빨라짐, 끝에서 부드럽게) → 원래대로', () => {
    const s = 10_000;
    expect(enemySprintMul(s, s - CFG.windupMs - 1, CFG)).toBe(1);
    expect(enemySprintPhase(s, s - 10, CFG)).toBe('windup');
    expect(enemySprintMul(s, s - 10, CFG)).toBe(CFG.windupMul);
    expect(enemySprintMul(s, s, CFG)).toBeCloseTo(CFG.speedMul);
    expect(enemySprintMul(s, s + CFG.durationMs - CFG.easeOutMs / 2, CFG)).toBeLessThan(CFG.speedMul);
    expect(enemySprintPhase(s, s + CFG.durationMs, CFG)).toBe('none');
  });

  it('돌격형 일반 적만: 보병(E01)·척후병(E02)은 되고, 박격포(E03)·보스(E05)·전차(E04)·MiG는 안 됨', () => {
    expect(canSprint(EN.E01 ?? {}, CFG)).toBe(true);
    expect(canSprint(EN.E02 ?? {}, CFG)).toBe(true);
    for (const id of ['E03', 'E04', 'E05', 'E38']) expect(canSprint(EN[id] ?? {}, CFG), id).toBe(false);
  });

  it('고르는 수는 count 범위, 같은 시드면 같은 선택, 다음 시각은 주기 ± jitter', () => {
    const c = Array.from({ length: 20 }, (_, i) => i);
    for (let k = 0; k < 30; k++) {
      const n = pickSprinters(c, createRng(`p${k}`), CFG).length;
      expect(n).toBeGreaterThanOrEqual(CFG.count[0]);
      expect(n).toBeLessThanOrEqual(CFG.count[1]);
    }
    expect(pickSprinters(c, createRng('x'), CFG)).toEqual(pickSprinters(c, createRng('x'), CFG));
    expect(pickSprinters([1], createRng('y'), CFG).length).toBeLessThanOrEqual(1);
    const t = nextSprintSec(100, createRng('n'), CFG);
    expect(t).toBeGreaterThanOrEqual(100 + CFG.everySec * (1 - CFG.jitter));
    expect(t).toBeLessThanOrEqual(100 + CFG.everySec * (1 + CFG.jitter));
  });
});
