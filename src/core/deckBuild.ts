// 덱 편집 규칙(PRD §3 출정 준비·§5.3.1): 정확히 size장, 등급별 같은 카드 최대 장수, 해금된 카드만, 마이너스 카드 불가.
// 덱은 카드 ID 배열(순서 무관). Phaser 없음(테스트 대상).

export interface DeckCard {
  name: string;
  tag: string;
  grade: string;
}

export interface DeckRules {
  size: number;
  maxCopies: Readonly<Record<string, number>>;
  lockedByDefault: readonly string[];
}

export type DeckError = 'size' | 'copies' | 'locked' | 'minus' | 'unknown';

export function countBy(deck: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of deck) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** 덱에 넣을 수 있는 카드(마이너스 제외, 기본 잠금은 해금 목록에 있어야) */
export function available(cards: Readonly<Record<string, DeckCard>>, rules: DeckRules, unlocked: readonly string[]): string[] {
  return Object.entries(cards)
    .filter(([id, c]) => c.tag !== 'minus' && (!rules.lockedByDefault.includes(id) || unlocked.includes(id)))
    .map(([id]) => id);
}

export function maxCopies(card: DeckCard | undefined, rules: DeckRules): number {
  return card ? (rules.maxCopies[card.grade] ?? 0) : 0;
}

/** 이 카드를 한 장 더 넣을 수 없는 이유(되면 null) */
export function canAdd(deck: readonly string[], id: string, cards: Readonly<Record<string, DeckCard>>, rules: DeckRules, unlocked: readonly string[]): DeckError | null {
  const c = cards[id];
  if (!c) return 'unknown';
  if (c.tag === 'minus') return 'minus';
  if (!available(cards, rules, unlocked).includes(id)) return 'locked';
  if (deck.length >= rules.size) return 'size';
  if ((countBy(deck).get(id) ?? 0) >= maxCopies(c, rules)) return 'copies';
  return null;
}

export function addCard(deck: readonly string[], id: string, cards: Readonly<Record<string, DeckCard>>, rules: DeckRules, unlocked: readonly string[]): string[] {
  return canAdd(deck, id, cards, rules, unlocked) === null ? [...deck, id] : [...deck];
}

export function removeCard(deck: readonly string[], id: string): string[] {
  const i = deck.lastIndexOf(id);
  return i < 0 ? [...deck] : [...deck.slice(0, i), ...deck.slice(i + 1)];
}

/** 덱 전체 검사: 문제 목록(비면 출정 가능) */
export function validateDeck(deck: readonly string[], cards: Readonly<Record<string, DeckCard>>, rules: DeckRules, unlocked: readonly string[]): DeckError[] {
  const errs = new Set<DeckError>();
  if (deck.length !== rules.size) errs.add('size');
  const avail = new Set(available(cards, rules, unlocked));
  for (const [id, n] of countBy(deck)) {
    const c = cards[id];
    if (!c) errs.add('unknown');
    else if (c.tag === 'minus') errs.add('minus');
    else if (!avail.has(id)) errs.add('locked');
    else if (n > maxCopies(c, rules)) errs.add('copies');
  }
  return [...errs];
}

/**
 * 추천 덱: 조합 레시피의 짝을 고르게 갖추도록(레시피마다 필요한 태그를 1장씩 돌아가며 채움),
 * 남는 칸은 공용 카드(회복·지원)로. 같은 카드 장수 제한·해금 규칙을 지킨다.
 */
export function recommendedDeck(
  cards: Readonly<Record<string, DeckCard>>,
  combos: readonly { tags: readonly string[] }[],
  rules: DeckRules,
  unlocked: readonly string[],
): string[] {
  const avail = available(cards, rules, unlocked);
  // 태그별 후보: 흔한 등급부터(여러 장 넣을 수 있게)
  const order = ['common', 'rare', 'legendary'];
  const byTag = new Map<string, string[]>();
  for (const id of avail) {
    const t = cards[id]?.tag ?? '';
    byTag.set(t, [...(byTag.get(t) ?? []), id]);
  }
  for (const list of byTag.values()) list.sort((a, b) => order.indexOf(cards[a]?.grade ?? '') - order.indexOf(cards[b]?.grade ?? ''));
  let deck: string[] = [];
  const tryTag = (tag: string): boolean => {
    for (const id of byTag.get(tag) ?? []) {
      if (canAdd(deck, id, cards, rules, unlocked) === null) {
        deck = [...deck, id];
        return true;
      }
    }
    return false;
  };
  // 레시피를 돌아가며 태그를 하나씩: 2장짜리 짝이 먼저 갖춰진다
  let progress = true;
  while (deck.length < rules.size && progress) {
    progress = false;
    for (const combo of combos) {
      for (const tag of combo.tags) {
        if (deck.length >= rules.size) break;
        if (tryTag(tag)) progress = true;
      }
    }
  }
  // 그래도 남으면 아무 카드로
  for (const id of avail) while (deck.length < rules.size && canAdd(deck, id, cards, rules, unlocked) === null) deck = [...deck, id];
  return deck;
}
