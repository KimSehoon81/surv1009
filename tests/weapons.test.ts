import { describe, expect, it } from 'vitest';
import weapons from '../src/data/weapons.json';
import characters from '../src/data/characters.json';
import unlocksData from '../src/data/unlocks.json';
import { EFFECTS } from '../src/systems/effects';

const TYPES = ['projectile', 'lob', 'melee', 'aura', 'placeable'];

describe('weapons data', () => {
  it('모든 무기에 필수 값, 타입별 필수 값', () => {
    for (const [id, w] of Object.entries(weapons.weapons)) {
      expect(TYPES, id).toContain(w.type);
      expect(w.damageMult, id).toBeGreaterThan(0);
      const rec = w as Record<string, unknown>;
      if (w.type === 'projectile' || w.type === 'lob') expect(typeof rec.sprite, id).toBe('string');
      if (w.type === 'aura') expect(rec.auraRadius, id).toBeGreaterThan(0);
      if (w.type === 'placeable') expect((rec.mine as { radius: number }).radius, id).toBeGreaterThan(0);
      if (w.type === 'projectile') expect(rec.projectileSpeed, id).toBeGreaterThan(0);
      if (w.type === 'lob') for (const k of ['flightMs', 'aoeRadius']) expect(rec[k], `${id}.${k}`).toBeGreaterThan(0);
      if (w.type === 'melee') for (const k of ['meleeRadius', 'arcDeg']) expect(rec[k], `${id}.${k}`).toBeGreaterThan(0);
      if (rec.explode) expect((rec.explode as { radius: number }).radius, id).toBeGreaterThan(0);
    }
  });

  it('캐릭터 시작 무기가 정의되어 있음', () => {
    for (const [id, c] of Object.entries(characters.characters)) for (const w of c.weapons) expect(weapons.weapons, `${id}:${w}`).toHaveProperty(w);
  });
});

describe('캐릭터 30명 스키마', () => {
  const C = characters.characters as Record<string, { name: string; role: string; faction: string; unlock: string; implemented: boolean; stats: Record<string, number>; weapons: string[]; passive: Record<string, unknown>[] }>;
  it('A01~A30 전원, 필수 필드, 진영·해금 시점', () => {
    expect(Object.keys(C)).toEqual(Array.from({ length: 30 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`));
    const keys = Object.keys(C.A01?.stats ?? {});
    for (const [id, c] of Object.entries(C)) {
      expect(c.name && c.role, id).toBeTruthy();
      expect(['국군', '미군', '유엔군', '연합'], id).toContain(c.faction);
      expect(typeof c.implemented, id).toBe('boolean');
      expect(Object.keys(c.stats).sort(), id).toEqual([...keys].sort());
      expect(c.weapons.length, id).toBeGreaterThan(0);
    }
    const counts = Object.values(C).reduce<Record<string, number>>((m, c) => ({ ...m, [c.faction]: (m[c.faction] ?? 0) + 1 }), {});
    expect(counts).toEqual({ 국군: 10, 미군: 9, 유엔군: 10, 연합: 1 });
  });

  it('해금 시점이 unlocks.json과 일치(시작 3명 + 지역마다 3명)', () => {
    const sched = unlocksData.stages as Record<string, { chars: string[] }>;
    for (const [id, c] of Object.entries(C)) {
      if (c.unlock === '시작') expect(['A01', 'A02', 'A03'], id).toContain(id);
      else expect(sched[c.unlock]?.chars, id).toContain(id);
    }
  });

  it('구현 캐릭터 30명 전원, 패시브 트리거의 효과가 레지스트리에 있음', () => {
    expect(Object.entries(C).filter(([, c]) => c.implemented).map(([id]) => id)).toEqual(Array.from({ length: 30 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`));
    for (const [id, c] of Object.entries(C)) {
      for (const p of c.passive) {
        if (p.trigger) {
          expect(['hit', 'crit', 'kill'], id).toContain(p.trigger);
          expect(EFFECTS[p.effect as string], `${id}:${String(p.effect)}`).toBeTypeOf('function');
        }
      }
    }
  });
});
