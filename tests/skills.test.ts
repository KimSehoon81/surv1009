import { describe, expect, it } from 'vitest';
import skillsData from '../src/data/skills.json';
import timelinesData from '../src/data/timelines.json';
import controls from '../src/data/controls.json';
import { SkillSlots, type SkillDef } from '../src/core/skills';

const DEFS = skillsData.skills as Record<string, SkillDef>;
const make = () =>
  new SkillSlots(
    skillsData.slots.map((s) => ({ key: s.key, skillId: s.equip, locked: !s.unlocked, readyAtMs: 0 })),
    DEFS,
    skillsData.tp.max,
  );

describe('고급 스킬 데이터', () => {
  it('12종 메타데이터, Q·E·R·F 4슬롯(Q만 열림), 키는 controls.json에', () => {
    expect(Object.keys(DEFS)).toHaveLength(12);
    expect(skillsData.slots.map((s) => s.key)).toEqual(['Q', 'E', 'R', 'F']);
    expect(skillsData.slots.filter((s) => s.unlocked).map((s) => s.key)).toEqual(['Q']);
    const keys = controls.keys as Record<string, string[]>;
    for (const s of skillsData.slots) expect(keys[s.action], s.action).toEqual([s.key]);
    for (const d of Object.values(DEFS)) if (d.timeline) expect((timelinesData.timelines as Record<string, unknown>)[d.timeline], d.timeline).toBeDefined();
  });
});

describe('스킬 슬롯과 TP', () => {
  it('TP가 모자라면 거부, 차면 발동하고 TP 소모·쿨다운 시작', () => {
    const s = make();
    const cost = DEFS.AS03?.tpCost ?? 0;
    expect(s.cast(0, 0)).toEqual({ ok: false, reason: 'tp' });
    s.addTp(cost);
    expect(s.cast(0, 1000).ok).toBe(true);
    expect(s.tp).toBe(0);
    s.addTp(100);
    expect(s.cast(0, 2000)).toEqual({ ok: false, reason: 'cooldown' });
    expect(s.cooldownLeft(0, 1000 + (DEFS.AS03?.cooldownMs ?? 0) / 2)).toBeCloseTo(0.5);
    expect(s.cast(0, 1000 + (DEFS.AS03?.cooldownMs ?? 0)).ok).toBe(true);
  });

  it('TP는 0~최대로 자르고, 잠긴 슬롯·빈 슬롯·미구현 스킬은 발동하지 않는다', () => {
    const s = make();
    expect(s.addTp(999)).toBe(skillsData.tp.max);
    expect(s.addTp(-9999)).toBe(0);
    s.addTp(100);
    expect(s.cast(1, 0)).toEqual({ ok: false, reason: 'locked' });
    s.slots[1] = { key: 'E', skillId: null, locked: false, readyAtMs: 0 };
    expect(s.cast(1, 0)).toEqual({ ok: false, reason: 'empty' });
    s.slots[1] = { key: 'E', skillId: 'AS05', locked: false, readyAtMs: 0 };
    expect(s.cast(1, 0)).toEqual({ ok: false, reason: 'unimplemented' });
  });
});
