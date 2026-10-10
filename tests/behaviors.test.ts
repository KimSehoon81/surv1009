import { describe, expect, it } from 'vitest';
import enemies from '../src/data/enemies.json';
import spawn from '../src/data/spawn.json';
import { BEHAVIORS, steer, type BehaviorSpec } from '../src/core/behaviors';

const agent = (x: number, y: number, ageMs = 0, phase = 0) => ({ x, y, ageMs, phase });
const target = { targetX: 100, targetY: 0 };

describe('behaviors', () => {
  it('chase: 목표 방향 단위 벡터', () => {
    const d = steer(agent(0, 0), [{ type: 'chase' }], target);
    expect(d.x).toBeCloseTo(1);
    expect(d.y).toBeCloseTo(0);
  });

  it('zigzag: 추적에 옆 방향 흔들림이 더해지고 시간에 따라 좌우가 바뀐다', () => {
    const specs: BehaviorSpec[] = [{ type: 'chase' }, { type: 'zigzag', amplitude: 1, freq: 1 }];
    const a = steer(agent(0, 0, 250), specs, target); // sin(π/2)=1 → 옆으로
    const b = steer(agent(0, 0, 750), specs, target); // sin(3π/2)=-1 → 반대쪽
    expect(a.x).toBeGreaterThan(0);
    expect(Math.sign(a.y)).toBe(-Math.sign(b.y));
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1);
  });

  it('목표 위에 있으면 멈춤(0), 모르는 부품은 오류', () => {
    expect(steer(agent(100, 0), [{ type: 'chase' }], target)).toEqual({ x: 0, y: 0 });
    expect(() => steer(agent(0, 0), [{ type: 'teleport' }], target)).toThrow();
  });

  it('데이터 검증: 모든 적의 행동 부품이 존재하고 필수 수치가 양수, 스폰 표의 적이 정의되어 있음', () => {
    for (const [id, e] of Object.entries(enemies.enemies)) {
      for (const b of e.behaviors) expect(BEHAVIORS[b.type], `${id}:${b.type}`).toBeTypeOf('function');
      for (const k of ['hp', 'speed', 'radius'] as const) expect(e[k], `${id}.${k}`).toBeGreaterThan(0);
    }
    for (const s of spawn.S1.spawns) expect(enemies.enemies).toHaveProperty(s.enemy);
  });
});
