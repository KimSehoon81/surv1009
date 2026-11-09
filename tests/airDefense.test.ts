import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import disruptionsData from '../src/data/disruptions.json';
import enemiesData from '../src/data/enemies.json';
import timelinesData from '../src/data/timelines.json';
import skillsData from '../src/data/skills.json';
import combat from '../src/data/combat.json';
import { createCardState, previewSubmit, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';

const DATA: CardData = {
  cards: cardsData.cards as unknown as CardData['cards'],
  combos: combosData.combos as ComboDef[],
  rules: rulesData as unknown as CardRules,
};
const AIR = disruptionsData.types.airDefense.tagPenalty;
const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0, ...over });
function withHand(ids: string[]): CardState {
  const { state } = createCardState([], DATA, env(), createRng(0));
  const hand: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i, disguised: false }));
  return { ...state, hand, nextUid: ids.length + 1 };
}
const chance = (ids: string[], uids: number[], over: Partial<CardEnv> = {}) => previewSubmit(withHand(ids), uids, false, env(over), DATA).chance;

describe('적 방공망(PRD §5.4 b, D25)', () => {
  it('공군 카드가 들어간 제출만 −15%p, 환경 보정 항으로 보임', () => {
    expect(AIR.air).toBeCloseTo(0.15);
    const air = chance(['P04'], [1], { tagPenalty: AIR });
    expect(air?.final).toBeCloseTo(0.15);
    expect(air?.terms.find((t) => t.key === 'env')?.value).toBeCloseTo(-0.15);
    expect(chance(['P01'], [1], { tagPenalty: AIR })?.final).toBeCloseTo(0.3);
  });

  it('중첩 없음: 공군 카드 2장이어도 −15%p 한 번', () => {
    expect(chance(['P04', 'P04'], [1, 2], { tagPenalty: AIR })?.final).toBeCloseTo(0.35 - 0.15);
  });

  it('데이터: 방공포병이 방공망을 걸고 요격 대상, 항공 타임라인에 요격 표시, AS01·AS04 연결', () => {
    const e23 = enemiesData.enemies.E23 as { antiAir?: boolean; disrupt?: { type: string } };
    expect(e23.antiAir).toBe(true);
    expect(e23.disrupt?.type).toBe('airDefense');
    expect(disruptionsData.types.airDefense.category).toBe('b');
    const T = timelinesData.timelines as Record<string, { intercept?: boolean; events: unknown[] }>;
    for (const id of ['precision_bomb', 'bomber_wing', 'AS01', 'AS03']) expect(T[id]?.intercept, id).toBe(true);
    expect(T.naval_support?.intercept).toBeUndefined();
    expect(skillsData.skills.AS01.timeline).toBe('AS01');
    expect(skillsData.skills.AS04.timeline).toBe('AS04');
    expect(combat.intercept.chance).toBeGreaterThan(0);
    expect(combat.intercept.damageMul).toBeLessThan(1);
  });
});
