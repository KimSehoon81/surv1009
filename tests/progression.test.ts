import { describe, expect, it } from 'vitest';
import levels from '../src/data/levels.json';
import upgradesData from '../src/data/upgrades.json';
import { gainXp, xpToNext } from '../src/core/xp';
import { applyMods, modValue } from '../src/core/stats';
import { describe as describeUpgrade, eligible, rarityProbs, rollChoices, type RarityConfig, type RollContext, type UpgradeDef } from '../src/core/upgrades';
import { Progression, type UpgradeTarget } from '../src/core/progression';
import { createRng } from '../src/core/rng';

const XP = levels.xp;
const RARITY = upgradesData.rarity as unknown as RarityConfig;
const DEFS = upgradesData.upgrades as unknown as UpgradeDef[];
const FALLBACKS = upgradesData.fallbacks as unknown as UpgradeDef[];
const ctx = (over: Partial<RollContext> = {}): RollContext => ({ count: 3, luck: 0, rarePlusBonus: 0, valueMultiplier: 1, owned: {}, weapons: ['rifle'], ...over });

describe('경험치(PRD §4.2)', () => {
  it('Lv1→2 = 20, 단계마다 ×1.35, Lv9→10 ≈ 220, 최대 레벨 이후 없음', () => {
    expect(xpToNext(1, XP)).toBe(20);
    expect(xpToNext(2, XP)).toBe(27);
    expect(xpToNext(9, XP)).toBeGreaterThanOrEqual(218);
    expect(xpToNext(9, XP)).toBeLessThanOrEqual(222);
    expect(xpToNext(10, XP)).toBe(Infinity);
  });

  it('한 번에 여러 레벨, 남은 경험치 이월, 최대 레벨에서 멈춤', () => {
    const r = gainXp({ level: 1, xp: 0 }, 20 + 27 + 5, XP);
    expect(r).toEqual({ state: { level: 3, xp: 5 }, levelsGained: 2 });
    const max = gainXp({ level: 9, xp: 0 }, 99999, XP);
    expect(max.state).toEqual({ level: 10, xp: 0 });
    expect(max.levelsGained).toBe(1);
    expect(gainXp(max.state, 50, XP).levelsGained).toBe(0);
  });
});

describe('능력치 수정자', () => {
  it('(기본 + add 합) × (1 + mul 합), 한계값으로 자름', () => {
    const mods = [
      { stat: 'attack', op: 'add' as const, value: 2 },
      { stat: 'attack', op: 'mul' as const, value: 0.1 },
      { stat: 'attack', op: 'mul' as const, value: 0.1 },
    ];
    expect(modValue(10, 'attack', mods)).toBeCloseTo(14.4);
    expect(modValue(0.9, 'critChance', [{ stat: 'critChance', op: 'add', value: 0.5 }], { critChance: [0, 1] })).toBe(1);
    const s = applyMods({ attack: 10, hp: 100 }, mods);
    expect(s).toEqual({ attack: expect.closeTo(14.4, 5), hp: 100 });
  });
});

describe('업그레이드 추첨', () => {
  it('레어도 확률: 합 1, 기본 60/28/10/2, 행운이 오를수록 희귀 이상 증가', () => {
    const p0 = rarityProbs(RARITY, 0);
    expect(p0.common + p0.uncommon + p0.rare + p0.legendary).toBeCloseTo(1);
    expect(p0.common).toBeCloseTo(0.6);
    expect(p0.legendary).toBeCloseTo(0.02);
    let prev = p0.rare + p0.legendary;
    for (let luck = 1; luck <= 10; luck++) {
      const p = rarityProbs(RARITY, luck);
      expect(p.rare + p.legendary).toBeGreaterThan(prev);
      prev = p.rare + p.legendary;
    }
  });

  it('희귀 이상 +30%p 보정(정찰 보고서)은 그만큼 정확히 옮긴다', () => {
    const a = rarityProbs(RARITY, 0);
    const b = rarityProbs(RARITY, 0, 0.3);
    expect(b.rare + b.legendary - (a.rare + a.legendary)).toBeCloseTo(0.3);
    expect(b.common + b.uncommon + b.rare + b.legendary).toBeCloseTo(1);
  });

  it('중복 없이 3개, 최대 단계·무기 조건 제외, 같은 시드면 같은 결과', () => {
    const owned = { hp: 5 };
    const a = rollChoices(DEFS, FALLBACKS, RARITY, ctx({ owned }), createRng('u'));
    const b = rollChoices(DEFS, FALLBACKS, RARITY, ctx({ owned }), createRng('u'));
    expect(a.map((c) => c.def.id)).toEqual(b.map((c) => c.def.id));
    expect(new Set(a.map((c) => c.def.id)).size).toBe(3);
    for (let seed = 0; seed < 200; seed++) {
      const r = rollChoices(DEFS, FALLBACKS, RARITY, ctx({ owned }), createRng(seed));
      for (const c of r) {
        expect(c.def.id).not.toBe('hp');
        expect(c.def.id).not.toBe('grenade_up'); // 수류탄이 없으면 강화 불가
      }
    }
    const withGrenade = eligible(DEFS, ctx({ weapons: ['rifle', 'grenade'] })).map((d) => d.id);
    expect(withGrenade).toContain('grenade_up');
    expect(withGrenade).not.toContain('grenade_new');
  });

  it('후보가 모자라면 대체 보상, 4지선다(count 4)', () => {
    const owned: Record<string, number> = {};
    for (const d of DEFS) owned[d.id] = d.maxLevel;
    owned.speed = 4;
    const r = rollChoices(DEFS, FALLBACKS, RARITY, ctx({ owned }), createRng(1));
    expect(r.map((c) => c.def.id)).toEqual(['speed', 'first_aid', 'supply_pull']);
    expect(r[1]?.fallback).toBe(true);
    expect(rollChoices(DEFS, FALLBACKS, RARITY, ctx({ count: 4 }), createRng(2))).toHaveLength(4);
  });

  it('레어도·작전계획서 배율이 수치에 곱해지고, 설명에 반영된다', () => {
    const atk = DEFS.find((d) => d.id === 'attack') as UpgradeDef;
    const r = rollChoices([atk], [], RARITY, ctx({ count: 1, valueMultiplier: 2 }), createRng(3))[0];
    const k = RARITY.value[r?.rarity ?? 'common'] * 2;
    expect(r?.mods[0]?.value).toBeCloseTo(0.1 * k);
    expect(describeUpgrade(atk, r?.mods ?? [])).toBe(`공격력 +${Math.round(10 * k * 10) / 10}%`);
  });
});

describe('레벨업 흐름', () => {
  const makeTarget = () => {
    const log: string[] = [];
    const weapons = ['rifle'];
    const t: UpgradeTarget = {
      luck: 0,
      weapons,
      addPlayerMods: (m) => log.push(`player:${m.map((x) => x.stat).join(',')}`),
      addWeaponMods: (id, m) => log.push(`weapon:${id}:${m.map((x) => x.stat).join(',')}`),
      addWeapon: (id) => {
        weapons.push(id);
        log.push(`add:${id}`);
      },
      heal: (f) => log.push(`heal:${f}`),
      pullAll: () => log.push('pull'),
    };
    return { t, log, weapons };
  };
  const cfg = { xp: XP, rarity: RARITY, upgrades: DEFS, fallbacks: FALLBACKS, rerolls: 1 };

  it('여러 레벨이 쌓이면 하나씩 차례로 열린다', () => {
    const p = new Progression(cfg, createRng('p'));
    const { t } = makeTarget();
    expect(p.addXp(20 + 27)).toBe(2);
    expect(p.open(t)).toHaveLength(3);
    expect(p.open(t)).toBe(p.choices); // 열린 동안 다시 뽑지 않음
    p.choose(0, t);
    expect(p.pending).toBe(1);
    expect(p.isOpen).toBe(false);
    p.open(t);
    p.choose(1, t);
    expect(p.pending).toBe(0);
    expect(p.open(t)).toBeNull();
    expect(p.history).toHaveLength(2);
  });

  it('리롤은 횟수만큼, 다음 레벨업 보정은 한 번만 적용', () => {
    const p = new Progression(cfg, createRng('r'));
    const { t } = makeTarget();
    p.addXp(500);
    p.nextBonus = { count: 4 };
    expect(p.open(t)).toHaveLength(4);
    expect(p.reroll()).toBe(true);
    expect(p.choices).toHaveLength(4); // 리롤도 같은 보정
    expect(p.reroll()).toBe(false);
    p.choose(0, t);
    expect(p.open(t)).toHaveLength(3);
  });

  it('선택 적용: 무기 신규·무기 강화·대체 보상', () => {
    const grenade = DEFS.find((d) => d.id === 'grenade_new') as UpgradeDef;
    const up = DEFS.find((d) => d.id === 'rifle_up') as UpgradeDef;
    const p = new Progression({ ...cfg, upgrades: [grenade, up] }, createRng('a'));
    const { t, log } = makeTarget();
    p.addXp(20 + 27 + 37);
    p.open(t);
    const ids = p.choices?.map((c) => c.def.id) ?? [];
    p.choose(ids.indexOf('grenade_new'), t);
    expect(log).toContain('add:grenade');
    p.open(t);
    const ids2 = p.choices?.map((c) => c.def.id) ?? [];
    p.choose(ids2.indexOf('rifle_up'), t);
    expect(log).toContain('weapon:rifle:damageMult');
    p.open(t);
    expect(p.choices?.map((c) => c.def.id)).toEqual(['rifle_up', 'first_aid', 'supply_pull']);
    p.choose(1, t);
    expect(log).toContain('heal:0.3');
  });
  it('전술 종류는 일반 추첨에 나오지 않고, 전술 슬롯이 있으면 1개 더 붙었다가 고르면 줄어든다', () => {
    const p = new Progression(cfg, createRng('tac'));
    const { t } = makeTarget();
    p.addXp(xpToNext(1, XP) * 40);
    const tacticalIds = new Set(DEFS.filter((d) => d.kind === 'tactical').map((d) => d.id));
    expect(tacticalIds.size).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      const c = p.open(t) ?? [];
      expect(c).toHaveLength(3);
      expect(c.some((x) => tacticalIds.has(x.def.id))).toBe(false);
      p.choose(0, t);
    }
    p.tacticalSlots = 1;
    const c = p.open(t) ?? [];
    expect(c).toHaveLength(4);
    const extra = c[3];
    expect(extra && (extra.def.kind === 'tactical' || extra.def.kind === 'card')).toBe(true);
    expect(new Set(c.map((x) => x.def.id)).size).toBe(4);
    p.choose(3, t);
    expect(p.tacticalSlots).toBe(0);
    expect(p.open(t)).toHaveLength(3);
  });
});
