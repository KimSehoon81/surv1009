import { describe, expect, it } from 'vitest';
import enemiesData from '../src/data/enemies.json';
import { ATTACK_PARTS, createAttackState, damageTakenMult, moveMode, stepAttack, type AttackSpec, type AttackCtx } from '../src/core/enemyAttack';
import { BEHAVIORS, steer } from '../src/core/behaviors';

const E = enemiesData.enemies as Record<string, { attacks?: AttackSpec[]; behaviors: { type: string }[] }>;
const ctx = (over: Partial<AttackCtx> = {}): AttackCtx => ({ x: 0, y: 0, targetX: 200, targetY: 0, sinceHurtMs: Infinity, ...over });
const ready = (specs: AttackSpec[]) => {
  const s = createAttackState(specs, () => 0);
  s.cooldowns = specs.map(() => 0);
  return s;
};
/** 16ms씩 진행하며 단계 변화를 [시각, 이벤트]로 */
function run(specs: AttackSpec[], ms: number, c: AttackCtx = ctx()) {
  const s = ready(specs);
  const log: [number, string][] = [];
  for (let t = 0; t <= ms; t += 16) for (const ev of stepAttack(s, specs, 16, c, 600)) log.push([t, ev.type]);
  return { s, log };
}

describe('적 공격 단계 상태기계', () => {
  it('데이터의 공격·이동 부품이 모두 등록돼 있다', () => {
    for (const [id, def] of Object.entries(E)) {
      for (const a of def.attacks ?? []) expect(ATTACK_PARTS[a.type], `${id}:${a.type}`).toBeDefined();
      for (const b of def.behaviors) expect(BEHAVIORS[b.type], `${id}:${b.type}`).toBeDefined();
    }
  });

  it('곡사: 사거리 안이면 준비 → 예고(최소 0.6초 보장) → 착탄 → 회복 → 쿨다운', () => {
    const lob: AttackSpec = { type: 'lob', range: [100, 300], cooldownMs: 3000, windupMs: 200, telegraphMs: 300, activeMs: 50, recoverMs: 400 };
    const { s, log } = run([lob], 2000);
    const at = (t: string) => log.find((l) => l[1] === t)?.[0] ?? -1;
    expect(at('telegraph')).toBeGreaterThanOrEqual(200);
    expect(at('active') - at('telegraph')).toBeGreaterThanOrEqual(600 - 16);
    expect(log.map((l) => l[1])).toEqual(['windup', 'telegraph', 'active', 'recover', 'end']);
    expect(s.phase).toBe('idle');
    expect(s.cooldowns[0]).toBeGreaterThan(2000);
    // 예고 시작 순간 목표 지점을 고정
    expect(s.tx).toBe(200);
  });

  it('사거리 밖이면 시작하지 않는다', () => {
    const lob: AttackSpec = { type: 'lob', range: [100, 300], cooldownMs: 3000, activeMs: 50, recoverMs: 400 };
    expect(run([lob], 1000, ctx({ targetX: 500 })).log).toEqual([]);
  });

  it('방어 자세: 맞은 직후에만, 3초 −60% → 1.5초 약점 ×1.5 → 원래대로', () => {
    const guard = E.E04?.attacks?.find((a) => a.type === 'guard') as AttackSpec;
    expect(run([guard], 500).log).toEqual([]);
    const s = ready([guard]);
    stepAttack(s, [guard], 16, ctx({ sinceHurtMs: 100 }), 600);
    expect(s.phase).toBe('active');
    expect(damageTakenMult(s, [guard])).toBeCloseTo(0.4);
    expect(moveMode(s, [guard])).toBe('hold');
    stepAttack(s, [guard], 3000, ctx(), 600);
    expect(s.phase).toBe('recover');
    expect(damageTakenMult(s, [guard])).toBeCloseTo(1.5);
    stepAttack(s, [guard], 1500, ctx(), 600);
    expect(s.phase).toBe('idle');
    expect(damageTakenMult(s, [guard])).toBe(1);
  });

  it('차징 돌진: 예고 중 제자리, 실행 중 고정 방향 돌진', () => {
    const dash = E.E04?.attacks?.find((a) => a.type === 'chargeDash') as AttackSpec;
    const s = ready([dash]);
    stepAttack(s, [dash], 16, ctx({ targetX: 0, targetY: 200 }), 600);
    expect(s.phase).toBe('windup');
    stepAttack(s, [dash], 300, ctx({ targetX: 0, targetY: 200 }), 600);
    expect(s.phase).toBe('telegraph');
    expect(moveMode(s, [dash])).toBe('hold');
    expect([s.dirX, s.dirY]).toEqual([0, 1]);
    stepAttack(s, [dash], 1000, ctx({ targetX: 999, targetY: 0 }), 600);
    expect(s.phase).toBe('active');
    expect(moveMode(s, [dash])).toBe('dash');
    // 목표가 움직여도 예고한 방향 그대로
    expect([s.dirX, s.dirY]).toEqual([0, 1]);
  });
});

describe('거리 유지 이동 부품', () => {
  const a = { x: 0, y: 0, ageMs: 0, phase: 0.2 };
  const spec = [{ type: 'keepDistance', min: 150, max: 250 }];
  it('가까우면 물러나고 멀면 다가가며 사이에서는 옆으로', () => {
    expect(steer(a, spec, { targetX: 100, targetY: 0 }).x).toBeLessThan(0);
    expect(steer(a, spec, { targetX: 400, targetY: 0 }).x).toBeGreaterThan(0);
    const mid = steer(a, spec, { targetX: 200, targetY: 0 });
    expect(Math.abs(mid.x)).toBeLessThan(1e-9);
    expect(Math.abs(mid.y)).toBeCloseTo(1);
  });
});
