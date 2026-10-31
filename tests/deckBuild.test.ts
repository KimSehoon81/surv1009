import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import { addCard, available, canAdd, countBy, recommendedDeck, removeCard, validateDeck, type DeckCard, type DeckRules } from '../src/core/deckBuild';

const CARDS = cardsData.cards as Record<string, DeckCard>;
const RULES = cardsData.deckRules as DeckRules;

describe('덱 편집 규칙', () => {
  it('기본 덱은 규칙을 지킨다(20장, 장수 제한, 잠긴 카드 없음)', () => {
    expect(validateDeck(cardsData.starterDeck, CARDS, RULES, [])).toEqual([]);
  });

  it('잠긴 카드·마이너스는 넣을 수 없고, 해금하면 넣을 수 있다', () => {
    expect(available(CARDS, RULES, [])).not.toContain('P12');
    expect(available(CARDS, RULES, []).some((id) => CARDS[id]?.tag === 'minus')).toBe(false);
    expect(canAdd([], 'P12', CARDS, RULES, [])).toBe('locked');
    expect(canAdd([], 'P12', CARDS, RULES, ['P12'])).toBeNull();
    expect(canAdd([], 'M01', CARDS, RULES, [])).toBe('minus');
    expect(canAdd([], 'X99', CARDS, RULES, [])).toBe('unknown');
  });

  it('등급별 같은 카드 최대 장수, 20장이 차면 더 못 넣음', () => {
    let d: string[] = [];
    for (let i = 0; i < 5; i++) d = addCard(d, 'P01', CARDS, RULES, []);
    expect(countBy(d).get('P01')).toBe(RULES.maxCopies.common);
    expect(canAdd(d, 'P01', CARDS, RULES, [])).toBe('copies');
    const full = [...cardsData.starterDeck];
    expect(canAdd(full, 'P02', CARDS, RULES, [])).toBe('size');
    expect(removeCard(full, 'P02')).toHaveLength(19);
    expect(validateDeck(removeCard(full, 'P02'), CARDS, RULES, [])).toEqual(['size']);
    expect(validateDeck([...full.slice(0, 17), 'P05', 'P05', 'P05'], CARDS, RULES, [])).toContain('copies');
  });

  it('추천 덱: 20장·규칙 통과, 2장 짝 조합 레시피의 태그를 모두 갖춤', () => {
    const d = recommendedDeck(CARDS, combosData.combos, RULES, []);
    expect(d).toHaveLength(20);
    expect(validateDeck(d, CARDS, RULES, [])).toEqual([]);
    const tags = new Set(d.map((id) => CARDS[id]?.tag));
    for (const c of combosData.combos.filter((x) => x.tags.length === 2)) for (const t of c.tags) expect(tags.has(t), t).toBe(true);
  });
});
