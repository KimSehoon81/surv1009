import { describe, expect, it } from 'vitest';
import weapons from '../src/data/weapons.json';
import characters from '../src/data/characters.json';

describe('weapons data', () => {
  it('모든 무기에 필수 값, 타입별 필수 값', () => {
    for (const [id, w] of Object.entries(weapons.weapons)) {
      expect(['projectile', 'lob'], id).toContain(w.type);
      expect(w.damageMult, id).toBeGreaterThan(0);
      expect(typeof w.sprite, id).toBe('string');
      const rec = w as Record<string, unknown>;
      if (w.type === 'projectile') expect(rec.projectileSpeed, id).toBeGreaterThan(0);
      if (w.type === 'lob') for (const k of ['flightMs', 'aoeRadius', 'cooldownMs']) expect(rec[k], `${id}.${k}`).toBeGreaterThan(0);
    }
  });

  it('캐릭터 시작 무기가 정의되어 있음', () => {
    for (const [id, c] of Object.entries(characters.characters)) for (const w of c.weapons) expect(weapons.weapons, `${id}:${w}`).toHaveProperty(w);
  });
});
