import { describe, expect, it } from 'vitest';
import combat from '../src/data/combat.json';
import { createSprint, sprintMul, sprintReady, sprinting, trySprint, type SprintConfig } from '../src/core/sprint';

const CFG = combat.sprint as SprintConfig;

describe('질주', () => {
  it('누르면 durationMs 동안 빨라지고 끝에서 부드럽게 1로, 재사용 대기 중엔 거부', () => {
    let s = createSprint();
    const r = trySprint(s, 1000, CFG);
    expect(r.ok).toBe(true);
    s = r.state;
    expect(sprintMul(s, 1000, CFG)).toBeCloseTo(CFG.speedMul);
    expect(sprinting(s, 1000 + CFG.durationMs - 1, CFG)).toBe(true);
    expect(sprintMul(s, 1000 + CFG.durationMs - CFG.easeOutMs / 2, CFG)).toBeLessThan(CFG.speedMul);
    expect(sprintMul(s, 1000 + CFG.durationMs, CFG)).toBe(1);
    expect(trySprint(s, 1000 + CFG.cooldownMs - 1, CFG).ok).toBe(false);
    expect(trySprint(s, 1000 + CFG.cooldownMs, CFG).ok).toBe(true);
  });

  it('게이지는 대기 동안 0→1, 수치는 상식 범위', () => {
    const s = trySprint(createSprint(), 0, CFG).state;
    expect(sprintReady(s, 0, CFG)).toBe(0);
    expect(sprintReady(s, CFG.cooldownMs / 2, CFG)).toBeCloseTo(0.5);
    expect(sprintReady(s, CFG.cooldownMs, CFG)).toBe(1);
    expect(CFG.durationMs).toBeLessThan(CFG.cooldownMs);
    expect(CFG.invulnMs).toBeLessThanOrEqual(CFG.durationMs);
  });
});
