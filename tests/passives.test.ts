import { describe, expect, it } from 'vitest';
import characters from '../src/data/characters.json';
import levels from '../src/data/levels.json';
import combat from '../src/data/combat.json';
import skillsData from '../src/data/skills.json';
import { applyMods, type StatLimits, type StatMod } from '../src/core/stats';
import { armorMult } from '../src/core/combat';
import { SkillSlots, type SkillDef } from '../src/core/skills';

type Char = { stats: Record<string, number>; passive: { mods?: StatMod[] }[]; armorType?: string };
const C = characters.characters as Record<string, Char>;
const statsOf = (id: string) => {
  const c = C[id] as Char;
  return applyMods<Record<string, number>>({ ...c.stats, ...levels.extraBaseStats }, c.passive.flatMap((p) => p.mods ?? []), levels.statLimits as StatLimits);
};

describe('D21 새 패시브 수정자', () => {
  it('군의관: 초당 회복 +2, 다른 캐릭터는 0', () => {
    expect(statsOf('A09').regen).toBe(2);
    expect(statsOf('A01').regen).toBe(0);
  });

  it('포병 관측병: 고급 스킬 쿨다운 ×0.75 → 슬롯 쿨다운이 그만큼 짧다', () => {
    const mul = statsOf('A14').skillCooldown;
    expect(mul).toBeCloseTo(0.75);
    const s = new SkillSlots([{ key: 'Q', skillId: 'AS03', locked: false, readyAtMs: 0 }], skillsData.skills as Record<string, SkillDef>, 100);
    s.addTp(100);
    expect(s.cast(0, 1000, mul).ok).toBe(true);
    const cd = (skillsData.skills.AS03.cooldownMs as number) * 0.75;
    expect(s.slots[0]?.readyAtMs).toBe(1000 + cd);
    expect(s.cooldownLeft(0, 1000 + cd / 2)).toBeCloseTo(0.5);
  });

  it('전차병 장갑: 일반 피해 ×0.8, 대전차 ×1.5, 장갑 없으면 ×1', () => {
    const t = combat.armor as Record<string, Record<string, number>>;
    expect(C.A15?.armorType).toBe('armored');
    expect(armorMult('armored', 'normal', t)).toBe(0.8);
    expect(armorMult('armored', 'antiTank', t)).toBe(1.5);
    expect(armorMult(undefined, 'antiTank', t)).toBe(1);
    expect(statsOf('A15').hp ?? 0).toBeGreaterThan(statsOf('A01').hp ?? 0);
  });

  it('레인저: 이동속도 +8%(곱)', () => {
    expect(statsOf('A13').moveSpeed).toBeCloseTo((C.A13?.stats.moveSpeed ?? 0) * 1.08);
  });
});
