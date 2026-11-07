import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import { recommend } from '../src/core/cardAdvisor';
import { cardStep, createCardState, previewSubmit, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { steer } from '../src/core/behaviors';
import { createRng } from '../src/core/rng';

const DATA: CardData = {
  cards: cardsData.cards as unknown as CardData['cards'],
  combos: combosData.combos as ComboDef[],
  rules: rulesData as unknown as CardRules,
};
const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0, ...over });
function withHand(ids: string[]): CardState {
  const { state } = createCardState([], DATA, env(), createRng(0));
  const hand: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i * 100, disguised: false }));
  return { ...state, hand, nextUid: ids.length + 1 };
}
const down = (s: CardState) => s.hand.filter((c) => c.faceDown).length;

describe('뒤집힌 카드(D24)', () => {
  it('flipHand: 앞면 카드 N장만 뒷면으로, 이미 뒷면이면 건너뜀, unflip으로 모두 앞면', () => {
    let s = withHand(['P01', 'P02', 'P03', 'P04', 'P05']);
    s = cardStep(s, { type: 'flipHand', count: 2 }, env(), createRng(1), DATA).state;
    expect(down(s)).toBe(2);
    s = cardStep(s, { type: 'flipHand', count: 2 }, env(), createRng(2), DATA).state;
    expect(down(s)).toBe(4);
    s = cardStep(s, { type: 'flipHand', count: 9 }, env(), createRng(3), DATA).state;
    expect(down(s)).toBe(5);
    s = cardStep(s, { type: 'unflip' }, env(), createRng(4), DATA).state;
    expect(down(s)).toBe(0);
  });

  it('같은 시드면 같은 카드가 뒤집힌다', () => {
    const s = withHand(['P01', 'P02', 'P03', 'P04', 'P05']);
    const a = cardStep(s, { type: 'flipHand', count: 3 }, env(), createRng('f'), DATA).state;
    const b = cardStep(s, { type: 'flipHand', count: 3 }, env(), createRng('f'), DATA).state;
    expect(a.hand.map((c) => c.faceDown)).toEqual(b.hand.map((c) => c.faceDown));
  });

  it('판정 규칙은 그대로 + 뒷면 보너스, 제출하면 공개 이벤트', () => {
    const s = withHand(['P01', 'P02']);
    s.hand[1] = { ...(s.hand[1] as CardInstance), faceDown: true };
    const pv = previewSubmit(s, [1, 2], false, env(), DATA);
    const bonus = DATA.rules.faceDownBonus ?? 0;
    expect(bonus).toBeGreaterThan(0);
    expect(pv.chance?.final).toBeCloseTo(0.35 + bonus);
    expect(pv.chance?.terms.map((t) => t.key)).toContain('faceDown');
    // 앞면만 내면 보너스 없음
    expect(previewSubmit(s, [1], false, env(), DATA).chance?.terms.map((t) => t.key)).not.toContain('faceDown');
    const r = cardStep(s, { type: 'submit', uids: [1, 2] }, env(), createRng(5), DATA);
    const rv = r.events.find((e) => e.type === 'revealed');
    expect(rv && rv.type === 'revealed' ? rv.cards.map((c) => [c.id, c.faceDown]) : []).toEqual([['P02', false]]);
  });

  it('추천 조합은 뒷면 카드를 고르지 않는다', () => {
    const s = withHand(['P04', 'P10', 'P01']);
    s.hand = s.hand.map((c) => ({ ...c, faceDown: c.uid !== 3 }));
    const a = recommend(s, env(), DATA);
    expect(a?.uids ?? []).not.toContain(1);
    expect(a?.uids ?? []).not.toContain(2);
  });

  it('stationary: 이동하지 않음', () => {
    expect(steer({ x: 0, y: 0, ageMs: 0, phase: 0 }, [{ type: 'stationary' }], { targetX: 100, targetY: 0 })).toEqual({ x: 0, y: 0 });
  });
});
