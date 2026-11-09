import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import { cardStep, createCardState, isMinus, minusChanceFor, minusMixAt, stageNumber, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';

const DATA: CardData = {
  cards: cardsData.cards as unknown as CardData['cards'],
  combos: combosData.combos as ComboDef[],
  rules: rulesData as unknown as CardRules,
};
const R = DATA.rules;
const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0, ...over });
function withHand(ids: string[], over: Partial<CardInstance>[] = []): CardState {
  const { state } = createCardState(cardsData.starterDeck, DATA, env(), createRng(0));
  const hand: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i, disguised: false, ...(over[i] ?? {}) }));
  return { ...state, hand, nextUid: ids.length + 1 };
}

describe('마이너스 혼입 곡선(PRD §5.4 c, D26)', () => {
  it('스테이지 1 = 5% → 10 = 25% 선형, Lv7부터 배율과 혼탁', () => {
    expect(minusChanceFor(1, R)).toBeCloseTo(0.05);
    expect(minusChanceFor(10, R)).toBeCloseTo(0.25);
    expect(minusChanceFor(5, R)).toBeCloseTo(0.05 + (0.2 * 4) / 9);
    expect(minusMixAt(1, 6, R)).toEqual({ chance: minusChanceFor(1, R), disguise: false });
    const late = minusMixAt(1, 7, R);
    expect(late.chance).toBeCloseTo(minusChanceFor(1, R) * (R.minusLate?.mult ?? 1));
    expect(late.disguise).toBe(true);
    expect(stageNumber('S5')).toBe(5);
    expect(stageNumber('?')).toBe(1);
  });

  it('드로우에 연결: 혼입률 25%면 뽑은 카드의 약 25%가 마이너스', () => {
    let s = withHand([]);
    let minus = 0;
    let drawn = 0;
    const rng = createRng('mix');
    for (let i = 0; i < 4000; i++) {
      // 손패를 버린 더미로 돌려 덱이 마르지 않게
      s = { ...s, discard: [...s.discard, ...s.hand.filter((c) => !isMinus(c.id, DATA)).map((c) => c.id)], hand: [] };
      const r = cardStep(s, { type: 'drawNow' }, env({ minusChance: 0.25 }), rng, DATA);
      s = r.state;
      for (const c of s.hand) {
        drawn++;
        if (isMinus(c.id, DATA)) minus++;
      }
    }
    expect(drawn).toBeGreaterThan(800);
    expect(minus / drawn).toBeGreaterThan(0.2);
    expect(minus / drawn).toBeLessThan(0.3);
  });
});

describe('혼탁 카드(PRD §5.4 a, D26)', () => {
  it('Lv7 이후 섞인 마이너스는 일반 카드를 흉내 내고, 맨 오른쪽에 붙지 않는다', () => {
    let s = withHand(['P01', 'P02', 'M01'], [{}, {}, {}]);
    const rng = createRng('d');
    let found: CardInstance | undefined;
    for (let i = 0; i < 50 && !found; i++) {
      const r = cardStep({ ...s, hand: s.hand.slice(0, 3) }, { type: 'drawNow' }, env({ minusChance: 1, disguiseMinus: true }), rng, DATA);
      found = r.state.hand.find((c) => c.disguised);
      if (found) s = r.state;
    }
    expect(found).toBeDefined();
    expect(isMinus(found?.id ?? '', DATA)).toBe(true);
    expect(isMinus(found?.disguiseAs ?? 'M01', DATA)).toBe(false);
    // 드러난 마이너스(M01)보다 왼쪽
    const ids = s.hand.map((c) => c.uid);
    expect(ids.indexOf(found?.uid ?? -1)).toBeLessThan(s.hand.findIndex((c) => c.id === 'M01'));
  });

  it('공개: 고르려 할 때(uids)·척후 보고(전부) → revealed 이벤트, 맨 오른쪽으로', () => {
    const s = withHand(['M02', 'P01', 'P02'], [{ disguised: true, disguiseAs: 'P03' }]);
    const r = cardStep(s, { type: 'reveal', uids: [1] }, env(), createRng(1), DATA);
    const ev = r.events.find((e) => e.type === 'revealed');
    expect(ev && ev.type === 'revealed' ? ev.cards.map((c) => c.id) : []).toEqual(['M02']);
    expect(r.state.hand.map((c) => c.id)).toEqual(['P01', 'P02', 'M02']);
    expect(r.state.hand[2]?.disguised).toBe(false);
    expect(cardStep(r.state, { type: 'reveal' }, env(), createRng(1), DATA).events).toEqual([]);
  });

  it('리롤(소년 통신병): 마이너스는 남기고 나머지를 같은 수만큼 새로', () => {
    const s = withHand(['P01', 'P02', 'P03', 'M01']);
    const r = cardStep(s, { type: 'rerollHand' }, env(), createRng(2), DATA);
    expect(r.state.hand).toHaveLength(4);
    expect(r.state.hand.filter((c) => c.id === 'M01')).toHaveLength(1);
    expect(r.state.hand.filter((c) => [1, 2, 3].includes(c.uid))).toHaveLength(0);
  });
});
