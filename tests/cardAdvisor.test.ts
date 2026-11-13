import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import { recommend } from '../src/core/cardAdvisor';
import { createCardState, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';

const DATA: CardData = {
  cards: cardsData.cards as unknown as CardData['cards'],
  combos: combosData.combos as ComboDef[],
  rules: rulesData as unknown as CardRules,
};
const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0, ...over });
function hand(ids: string[], over: Partial<CardState> = {}): CardState {
  const { state } = createCardState([], DATA, env(), createRng(0));
  const h: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i, disguised: false }));
  return { ...state, hand: h, ...over };
}

describe('추천 조합', () => {
  it('조합이 되는 카드를 우선, 남는 카드를 채워 성공률을 올림, 마이너스는 넣지 않음', () => {
    const a = recommend(hand(['P04', 'P10', 'P01', 'M05']), env(), DATA);
    expect(a?.combo).toBe('precision_bomb');
    expect(a?.uids).toEqual(expect.arrayContaining([1, 2]));
    expect(a?.uids).not.toContain(4);
    expect(a?.chance).toBeCloseTo(0.5);
    expect(a?.lose).toBe(3); // 실패하면 비기여 일반 카드(P01)가 사라짐
  });

  it('조합이 없으면 카드를 모아 성공률이 가장 높은 제출', () => {
    const a = recommend(hand(['P08', 'P05', 'P11']), env(), DATA);
    expect(a?.combo).toBeNull();
    expect(a?.uids).toHaveLength(3);
  });

  it('쓸 수 없는 태그(통신 두절)는 빼고, 낼 카드가 없으면 null', () => {
    const a = recommend(hand(['P04', 'P10']), env({ blockedTags: ['intel'] }), DATA);
    expect(a?.uids).toEqual([1]);
    expect(recommend(hand(['M01', 'M02']), env(), DATA)).toBeNull();
    expect(recommend(hand([]), env(), DATA)).toBeNull();
  });

  it('쿨다운 중이어도 추천은 보여 준다', () => {
    expect(recommend(hand(['P04', 'P04'], { cooldownUntilMs: 3000 }), env({ nowMs: 1000 }), DATA)?.combo).toBe('bomber_wing');
  });

  it('아껴 둘 카드(holdCards: 걷어낼 방해가 없을 때 통신 복구)는 단독 추천에서 빠지고, 조합 재료로는 쓴다', () => {
    const hold = { holdCards: rulesData.holdWithoutDisruption };
    const plain = recommend(hand(['P11', 'P01']), env(), DATA);
    expect(plain?.uids).toContain(1);
    const held = recommend(hand(['P11', 'P01']), env(hold), DATA);
    expect(held?.uids).toEqual([2]);
    expect(recommend(hand(['P11']), env(hold), DATA)).toBeNull();
    // 정보 + 공군 = 조합이면 통신 복구도 재료로
    const combo = recommend(hand(['P11', 'P04']), env(hold), DATA);
    if (combo?.combo) expect(combo.uids).toContain(1);
  });
});

