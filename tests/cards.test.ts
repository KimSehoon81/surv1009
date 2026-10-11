import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import { chanceBreakdown, pityChance, pseudoRandomC, type ChanceInput } from '../src/core/cardChance';
import { matchCombo, type ComboDef } from '../src/core/combos';
import {
  cardStep,
  createCardState,
  lossCandidate,
  minusChanceFor,
  previewSubmit,
  type CardData,
  type CardEnv,
  type CardEvent,
  type CardInstance,
  type CardRules,
  type CardState,
} from '../src/core/cards';
import { createRng } from '../src/core/rng';

const DATA: CardData = {
  cards: cardsData.cards as unknown as CardData['cards'],
  combos: combosData.combos as ComboDef[],
  rules: rulesData as unknown as CardRules,
};
const env = (over: Partial<CardEnv> = {}): CardEnv => ({
  nowMs: 0,
  handSize: 5,
  drawSpeed: 1,
  luck: 0,
  extraChance: 0,
  opForSeal: 10,
  minusChance: 0,
  ...over,
});
const baseInput: ChanceInput = { realCount: 1, hasIntel: false, intelPrimed: false, gamble: false, luck: 0, extra: 0, penalty: 0, envPenalty: 0, seal: false };

/** 원하는 카드로 손패를 직접 만든 상태 */
function withHand(ids: string[], over: Partial<CardState> = {}): CardState {
  const { state } = createCardState([], DATA, env(), createRng(0));
  const hand: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i * 100, disguised: false }));
  return { ...state, hand, nextUid: ids.length + 1, ...over };
}
const types = (ev: CardEvent[]) => ev.map((e) => e.type);
const find = <T extends CardEvent['type']>(ev: CardEvent[], t: T) => ev.find((e) => e.type === t) as Extract<CardEvent, { type: T }> | undefined;

describe('성공률(PRD §5.1)', () => {
  it('기본 30, 2장 +5, 3장 +10, 정보 +10(한 번), 상한 60, 인장 100', () => {
    const r = DATA.rules;
    expect(chanceBreakdown(baseInput, r).final).toBeCloseTo(0.3);
    expect(chanceBreakdown({ ...baseInput, realCount: 2 }, r).final).toBeCloseTo(0.35);
    expect(chanceBreakdown({ ...baseInput, realCount: 3, hasIntel: true }, r).final).toBeCloseTo(0.5);
    expect(chanceBreakdown({ ...baseInput, realCount: 3, hasIntel: true, intelPrimed: true }, r).final).toBeCloseTo(0.5);
    expect(chanceBreakdown({ ...baseInput, realCount: 3, hasIntel: true, gamble: true, luck: 5 }, r).final).toBeCloseTo(0.6);
    expect(chanceBreakdown({ ...baseInput, seal: true }, r).final).toBe(1);
    expect(chanceBreakdown({ ...baseInput, penalty: 0.1, envPenalty: 0.15 }, r).final).toBeCloseTo(0.05);
    const terms = chanceBreakdown({ ...baseInput, realCount: 2, hasIntel: true }, r).terms.map((t) => t.key);
    expect(terms).toEqual(['base', 'count', 'intel']);
  });

  it('연속 실패 완충: 장기 평균은 표시 확률 그대로, 30%면 최장 연패 8회', () => {
    for (const p of [0.3, 0.45, 0.6]) {
      const rng = createRng(`pity${p}`);
      let streak = 0;
      let longest = 0;
      let wins = 0;
      const N = 100_000;
      for (let i = 0; i < N; i++) {
        if (rng.next() < pityChance(p, streak)) {
          wins++;
          streak = 0;
        } else longest = Math.max(longest, ++streak);
      }
      expect(Math.abs(wins / N - p)).toBeLessThan(0.01);
      if (p === 0.3) expect(longest).toBeLessThanOrEqual(8);
    }
    expect(pseudoRandomC(0.3)).toBeCloseTo(0.119, 2);
    expect(pityChance(0.3, 8)).toBe(1);
  });
});

describe('실제 제출 1만 회(PRD §5.1 완료 기준)', () => {
  it('단일 카드 제출 성공률 30%±1%, 최장 연패 8회 이하', () => {
    let s = withHand(['P01'], { drawPile: [] });
    const rng = createRng('ten-thousand');
    let wins = 0;
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      s = { ...s, hand: [{ uid: 1, id: 'P01', drawnAtMs: 0, disguised: false }], seals: 0 };
      const r = cardStep(s, { type: 'submit', uids: [1] }, env({ nowMs: i * 3000 }), rng, DATA);
      if (find(r.events, 'judged')?.success) wins++;
      s = r.state;
    }
    expect(Math.abs(wins / N - 0.3)).toBeLessThan(0.01);
    expect(s.stats.longestFailStreak).toBeLessThanOrEqual(8);
    expect(s.stats.submits).toBe(N);
  });
});

describe('조합 매칭(PRD §5.3)', () => {
  const t = (tags: string[]) => tags.map((tag, i) => ({ uid: i + 1, tag }));
  it('가장 많은 카드를 쓰는 레시피, 같으면 priority', () => {
    expect(matchCombo(t(['air', 'intel']), DATA.combos)?.combo.id).toBe('precision_bomb');
    expect(matchCombo(t(['infantry', 'infantry', 'infantry']), DATA.combos)?.combo.id).toBe('volley_fire');
    expect(matchCombo(t(['allied', 'infantry', 'infantry']), DATA.combos)?.combo.id).toBe('support_fire');
    // 정밀 폭격·연발탄은 장수·priority가 같음 → 표에서 먼저 나온 것
    expect(matchCombo(t(['artillery', 'intel', 'air']), DATA.combos)?.combo.id).toBe('precision_bomb');
    expect(matchCombo(t(['medical', 'navy']), DATA.combos)).toBeNull();
  });
  it('쿨다운 중인 레시피(연합군 총공세 60초)는 빠짐', () => {
    const allied = t(['allied', 'allied', 'allied']);
    expect(matchCombo(allied, DATA.combos, { allied_offensive: 60_000 }, 1000)).toBeNull();
    expect(matchCombo(allied, DATA.combos, { allied_offensive: 60_000 }, 60_000)?.combo.id).toBe('allied_offensive');
  });
});

describe('덱·드로우', () => {
  it('시작 손패 3장, 6초마다 1장, 손패가 가득 찬 동안 타이머가 쌓이지 않음', () => {
    const deck = cardsData.starterDeck;
    let { state } = createCardState(deck, DATA, env(), createRng(1));
    expect(state.hand).toHaveLength(3);
    expect(state.drawPile).toHaveLength(17);
    state = cardStep(state, { type: 'tick', dtMs: 5999 }, env(), createRng(2), DATA).state;
    expect(state.hand).toHaveLength(3);
    const r = cardStep(state, { type: 'tick', dtMs: 1 }, env(), createRng(2), DATA);
    expect(types(r.events)).toEqual(['drawn']);
    state = cardStep(r.state, { type: 'tick', dtMs: 6000 }, env(), createRng(2), DATA).state;
    expect(state.hand).toHaveLength(5);
    // 가득 찬 동안 60초가 지나도 쌓이지 않음 → 한 장 쓰면 다시 6초 기다림
    state = cardStep(state, { type: 'tick', dtMs: 60_000 }, env(), createRng(2), DATA).state;
    state = { ...state, hand: state.hand.slice(1) };
    expect(cardStep(state, { type: 'tick', dtMs: 100 }, env(), createRng(2), DATA).state.hand).toHaveLength(4);
  });

  it('드로우 속도 배율, 더미가 비면 버린 더미를 섞음, 손패 상한(손패 +1)', () => {
    let state = withHand([], { drawPile: [], discard: ['P01', 'P02'] });
    const r = cardStep(state, { type: 'tick', dtMs: 3000 }, env({ drawSpeed: 2 }), createRng(3), DATA);
    expect(types(r.events)).toEqual(['reshuffled', 'drawn']);
    state = withHand(['P01', 'P01', 'P01', 'P01', 'P01'], { drawPile: ['P02'] });
    expect(cardStep(state, { type: 'tick', dtMs: 6000 }, env({ handSize: 6 }), createRng(3), DATA).state.hand).toHaveLength(6);
  });

  it('마이너스 혼입은 맨 오른쪽 칸, 12초 뒤 자동 발동', () => {
    let state = withHand(['P01', 'P02'], { drawPile: ['P03', 'P04'] });
    state = cardStep(state, { type: 'tick', dtMs: 6000 }, env({ minusChance: 1 }), createRng(4), DATA).state;
    const minus = state.hand[2] as CardInstance;
    expect(DATA.cards[minus.id]?.tag).toBe('minus');
    state = cardStep(state, { type: 'add', id: 'P05' }, env({ nowMs: 100 }), createRng(4), DATA).state;
    expect(state.hand.map((c) => DATA.cards[c.id]?.tag).at(-1)).toBe('minus');
    const r = cardStep(state, { type: 'tick', dtMs: 16 }, env({ nowMs: 12_000 }), createRng(4), DATA);
    expect(find(r.events, 'minusTriggered')?.mult).toBe(1);
    expect(r.state.hand.some((c) => c.uid === minus.uid)).toBe(false);
  });

  it('혼입 확률: 스테이지 1 5% → 10 25%', () => {
    expect(minusChanceFor(1, DATA.rules)).toBeCloseTo(0.05);
    expect(minusChanceFor(10, DATA.rules)).toBeCloseTo(0.25);
    expect(minusChanceFor(5.5, DATA.rules)).toBeCloseTo(0.15);
  });
});

describe('제출과 판정', () => {
  it('성공: 전부 소모, 조합 스킬 + 레시피 밖 카드는 단일 효과', () => {
    const state = withHand(['P04', 'P10', 'P08'], { seals: 1 });
    const r = cardStep(state, { type: 'submit', uids: [1, 2, 3], useSeal: true }, env(), createRng(5), DATA);
    expect(find(r.events, 'judged')?.success).toBe(true);
    expect(find(r.events, 'comboSkill')?.combo).toBe('precision_bomb');
    expect(r.events.filter((e) => e.type === 'cardEffect').map((e) => (e as { card: CardInstance }).card.id)).toEqual(['P08']);
    expect(r.state.hand).toHaveLength(0);
    expect(r.state.discard).toEqual(['P04', 'P10', 'P08']);
    expect(find(r.events, 'sealUsed')?.seals).toBe(0);
  });

  it('인장(useSeal): 보유 없으면 거부, 있으면 100% 성공하고 1개 소모', () => {
    const none = cardStep(withHand(['P01']), { type: 'submit', uids: [1], useSeal: true }, env(), createRng(6), DATA);
    expect(find(none.events, 'rejected')?.reason).toBe('noSeal');
    const r = cardStep(withHand(['P01'], { seals: 2 }), { type: 'submit', uids: [1], useSeal: true }, env(), createRng(6), DATA);
    expect(find(r.events, 'judged')?.actual).toBe(1);
    expect(r.state.seals).toBe(1);
    expect(r.state.stats.sealsUsed).toBe(1);
  });

  it('실패: 최저 등급 1장 소멸(동률이면 레시피 비기여 → 오래된 카드), 나머지 손패, OP +1', () => {
    // P04(희귀) P10(일반) P08(일반): 정밀 폭격에 쓰이는 P10 대신 비기여 P08이 소멸
    const s = withHand(['P04', 'P10', 'P08']);
    expect(lossCandidate(s.hand, DATA, {}, 0)?.id).toBe('P08');
    // 같은 등급·둘 다 비기여면 손패에 오래 있던 카드
    expect(lossCandidate(withHand(['P08', 'P11']).hand, DATA, {}, 0)?.id).toBe('P08');
    let fail: ReturnType<typeof cardStep> | undefined;
    for (let seed = 0; seed < 50 && !fail; seed++) {
      const r = cardStep(s, { type: 'submit', uids: [1, 2, 3] }, env(), createRng(seed), DATA);
      if (find(r.events, 'judged')?.success === false) fail = r;
    }
    expect(fail).toBeDefined();
    expect(find(fail?.events ?? [], 'lost')?.card.id).toBe('P08');
    expect(fail?.state.hand.map((c) => c.id)).toEqual(['P04', 'P10']);
    expect(fail?.state.op).toBe(1);
    expect(fail?.state.discard).toEqual(['P08']);
  });

  it('OP 10 → 인장, 인장 2개면 OP가 더 쌓이지 않음, 작전 숙련은 필요 OP를 줄임', () => {
    const failOnce = (st: CardState, opForSeal = 10) => {
      for (let seed = 0; ; seed++) {
        const r = cardStep(st, { type: 'submit', uids: [1] }, env({ opForSeal }), createRng(`f${seed}`), DATA);
        if (find(r.events, 'judged')?.success === false) return r;
      }
    };
    let r = failOnce(withHand(['P01', 'P02'], { op: 9 }));
    expect(r.state.seals).toBe(1);
    expect(r.state.op).toBe(0);
    expect(types(r.events)).toContain('sealGained');
    r = failOnce(withHand(['P01', 'P02'], { op: 7 }), 8);
    expect(r.state.seals).toBe(1);
    r = failOnce(withHand(['P01', 'P02'], { op: 4, seals: 2 }));
    expect(r.state.op).toBe(4);
    expect(types(r.events)).not.toContain('opGained');
  });

  it('제출 쿨다운 3초, 최대 3장, 손패에 없는 카드, 막힌 태그(통신 두절)', () => {
    const s = withHand(['P01', 'P02', 'P03', 'P10'], { cooldownUntilMs: 3000 });
    expect(find(cardStep(s, { type: 'submit', uids: [1] }, env({ nowMs: 2999 }), createRng(7), DATA).events, 'rejected')?.reason).toBe('cooldown');
    const ok = cardStep(s, { type: 'submit', uids: [1] }, env({ nowMs: 3000 }), createRng(7), DATA);
    expect(find(ok.events, 'judged')).toBeDefined();
    expect(ok.state.cooldownUntilMs).toBe(6000);
    expect(find(cardStep(s, { type: 'submit', uids: [1, 2, 3, 4] }, env({ nowMs: 5000 }), createRng(7), DATA).events, 'rejected')?.reason).toBe('tooMany');
    expect(find(cardStep(s, { type: 'submit', uids: [9] }, env({ nowMs: 5000 }), createRng(7), DATA).events, 'rejected')?.reason).toBe('notInHand');
    const blocked = cardStep(s, { type: 'submit', uids: [4] }, env({ nowMs: 5000, blockedTags: ['intel'] }), createRng(7), DATA);
    expect(find(blocked.events, 'rejected')?.reason).toBe('blockedTag');
  });

  it('마이너스 단독 제출 = OP 3으로 폐기(모자라면 거부), 판정·쿨다운 없음', () => {
    const lack = cardStep(withHand(['P01', 'M05'], { op: 2 }), { type: 'submit', uids: [2] }, env(), createRng(8), DATA);
    expect(find(lack.events, 'rejected')?.reason).toBe('notEnoughOp');
    const r = cardStep(withHand(['P01', 'M05'], { op: 5 }), { type: 'submit', uids: [2] }, env(), createRng(8), DATA);
    expect(types(r.events)).toEqual(['minusDiscarded']);
    expect(r.state.op).toBe(2);
    expect(r.state.hand.map((c) => c.id)).toEqual(['P01']);
    expect(r.state.cooldownUntilMs).toBe(-Infinity);
  });

  it('무리수: +10%p(마이너스는 장수에 안 셈), 성공하면 정화, 실패하면 2배 발동', () => {
    const s = withHand(['P01', 'M05']);
    const pv = previewSubmit(s, [1, 2], false, env(), DATA);
    expect(pv.chance?.final).toBeCloseTo(0.4);
    let win: ReturnType<typeof cardStep> | undefined;
    let lose: ReturnType<typeof cardStep> | undefined;
    for (let seed = 0; seed < 100 && (!win || !lose); seed++) {
      const r = cardStep(s, { type: 'submit', uids: [1, 2] }, env(), createRng(`g${seed}`), DATA);
      if (find(r.events, 'judged')?.success) win ??= r;
      else lose ??= r;
    }
    expect(find(win?.events ?? [], 'purified')?.card.id).toBe('M05');
    expect(win?.state.hand).toHaveLength(0);
    expect(find(lose?.events ?? [], 'minusTriggered')?.mult).toBe(2);
    expect(find(lose?.events ?? [], 'lost')?.card.id).toBe('P01');
  });

  it('척후 보고(정보 대기)·오보(감점 3회)·혼탁 카드 공개·같은 시드 같은 결과', () => {
    let s = withHand(['P01', 'P02', 'P03', 'P04']);
    s = cardStep(s, { type: 'primeIntel' }, env(), createRng(9), DATA).state;
    s = cardStep(s, { type: 'penalty', value: 0.1, submits: 3 }, env(), createRng(9), DATA).state;
    expect(previewSubmit(s, [1], false, env(), DATA).chance?.final).toBeCloseTo(0.3); // 30 + 10 − 10
    const r1 = cardStep(s, { type: 'submit', uids: [1] }, env(), createRng(10), DATA);
    const r2 = cardStep(s, { type: 'submit', uids: [1] }, env(), createRng(10), DATA);
    expect(r1.events).toEqual(r2.events);
    expect(r1.state.intelPrimed).toBe(false);
    expect(r1.state.penalties).toEqual([{ value: 0.1, submits: 2 }]);
    const d = withHand(['P01', 'M01']);
    d.hand[1] = { ...(d.hand[1] as CardInstance), disguised: true };
    const rv = cardStep(d, { type: 'submit', uids: [1, 2] }, env(), createRng(11), DATA);
    expect(find(rv.events, 'revealed')?.cards[0]?.id).toBe('M01');
  });

  it('미리보기: 조합·확률·실패 시 사라질 카드, 거부 사유', () => {
    const s = withHand(['P03', 'P10', 'P01']);
    const pv = previewSubmit(s, [1, 2, 3], false, env(), DATA);
    expect(pv.combo).toBe('barrage');
    expect(pv.chance?.final).toBeCloseTo(0.5);
    expect(pv.lose).toBe(3);
    expect(previewSubmit(s, [], false, env(), DATA)).toEqual({ ok: false, reason: 'empty' });
  });

  it('연합군 총공세 후 60초 동안은 같은 조합이 안 나감, 런 통계', () => {
    const s = withHand(['P09', 'P15', 'P09', 'P09', 'P15', 'P15'], { seals: 2 });
    const r = cardStep(s, { type: 'submit', uids: [1, 2, 3], useSeal: true }, env(), createRng(12), DATA);
    expect(find(r.events, 'comboSkill')?.combo).toBe('allied_offensive');
    const again = cardStep(r.state, { type: 'submit', uids: [4, 5, 6], useSeal: true }, env({ nowMs: 30_000 }), createRng(12), DATA);
    expect(find(again.events, 'comboSkill')).toBeUndefined();
    expect(again.events.filter((e) => e.type === 'cardEffect')).toHaveLength(3);
    expect(again.state.stats).toMatchObject({ submits: 2, successes: 2, sealsUsed: 2 });
  });
});
