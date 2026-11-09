import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import characters from '../src/data/characters.json';
import weapons from '../src/data/weapons.json';
import levels from '../src/data/levels.json';
import { createCardState, previewSubmit, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';
import { applyMods, type StatMod } from '../src/core/stats';

const DATA: CardData = { cards: cardsData.cards as unknown as CardData['cards'], combos: combosData.combos as ComboDef[], rules: rulesData as unknown as CardRules };
const C = characters.characters as Record<string, { implemented?: boolean; weapons: string[]; cardBonus?: Record<string, number>; cardPower?: Record<string, number>; immuneTags?: string[]; passive: { mods?: StatMod[] }[] }>;
const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0, ...over });
function withHand(ids: string[]): CardState {
  const { state } = createCardState([], DATA, env(), createRng(0));
  const hand: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i, disguised: false }));
  return { ...state, hand };
}

describe('캐릭터 ③ A16~A23(D30)', () => {
  it('8명 구현, 무기는 weapons.json에 있음', () => {
    for (const id of ['A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23']) {
      expect(C[id]?.implemented, id).toBe(true);
      for (const w of C[id]?.weapons ?? []) expect(weapons.weapons, `${id}:${w}`).toHaveProperty(w);
    }
  });

  it('A22 캐릭터 보정: 공군 카드가 든 제출만 +10%p, 판정 내역에 캐릭터 보정 항(태그당 한 번)', () => {
    const bonus = C.A22?.cardBonus ?? {};
    expect(bonus.air).toBeCloseTo(0.1);
    const air = previewSubmit(withHand(['P04']), [1], false, env({ tagBonus: bonus }), DATA).chance;
    expect(air?.final).toBeCloseTo(0.4);
    expect(air?.terms.find((t) => t.key === 'char')?.value).toBeCloseTo(0.1);
    expect(previewSubmit(withHand(['P04', 'P04']), [1, 2], false, env({ tagBonus: bonus }), DATA).chance?.final).toBeCloseTo(0.45);
    expect(previewSubmit(withHand(['P01']), [1], false, env({ tagBonus: bonus }), DATA).chance?.terms.map((t) => t.key)).not.toContain('char');
  });

  it('A23 해군 강화·A20 아군 공격·A21 지형 감속 무시 데이터', () => {
    expect(C.A23?.cardPower?.navy).toBeGreaterThan(0);
    expect(cardsData.cards.P05.tag).toBe('navy');
    const ally = (C.A20?.passive ?? []).flatMap((p) => p.mods ?? []);
    const stats = applyMods(levels.extraBaseStats, ally);
    expect(stats.allyPower).toBeCloseTo(1.25);
    expect(C.A21?.immuneTags).toContain('terrain');
    expect((cardsData.cards.M06.params as { tag?: string }).tag).toBe('terrain');
  });
});

describe('캐릭터 ④ A24~A30(D31)', () => {
  it('30명 전원 implemented, 새 성질 데이터(회피·이동 중 회피·기습·연쇄·주기 지원·참모 보정)', async () => {
    const all = Object.entries(characters.characters);
    expect(all).toHaveLength(30);
    for (const [id, c] of all) expect((c as { implemented?: boolean }).implemented, id).toBe(true);
    const mods = (id: string) => (C[id]?.passive ?? []).flatMap((p) => p.mods ?? []).map((m) => m.stat);
    expect(mods('A24')).toContain('dodge');
    expect(mods('A27')).toContain('dodgeMoving');
    expect(mods('A28')).toContain('ambushCrit');
    expect((weapons.weapons as Record<string, { cluster?: unknown }>).cluster_grenade?.cluster).toBeDefined();
    const a29 = characters.characters.A29 as { periodic?: { timeline: string } };
    const { default: tl } = await import('../src/data/timelines.json');
    expect(tl.timelines).toHaveProperty(a29.periodic?.timeline ?? '?');
  });

  it("A30: 모든 제출 +5%p('*'), 태그 보정과 더해짐", () => {
    const bonus = { '*': 0.05, air: 0.1 };
    expect(previewSubmit(withHand(['P01']), [1], false, env({ tagBonus: bonus }), DATA).chance?.final).toBeCloseTo(0.35);
    expect(previewSubmit(withHand(['P04']), [1], false, env({ tagBonus: bonus }), DATA).chance?.final).toBeCloseTo(0.45);
  });
});
