import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import { EFFECTS, runEffect, type EffectContext, type Params } from '../src/systems/effects';
import { Buffs } from '../src/core/buffs';
import { applyMods, type StatMod } from '../src/core/stats';
import { cardStep, createCardState, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';

const CARDS = cardsData.cards as unknown as CardData['cards'];
const RESIDUE = cardsData.failResidue as Record<string, { effect: string; params: Params }>;

/** 호출 기록만 남기는 가짜 전투. schedule은 즉시 실행 */
function fakeCtx() {
  const calls: string[] = [];
  const buffs: { id: string; mods: StatMod[]; ms: number }[] = [];
  const bonus: object[] = [];
  const ctx: EffectContext = {
    nowMs: 0,
    player: { x: 0, y: 0, facing: 1 },
    rand: () => 0.5,
    fireBullet: (_x, _y, dmg) => calls.push(`bullet:${dmg}`),
    lob: (_x, _y, dmg) => calls.push(`lob:${dmg}`),
    explode: (_x, _y, r, dmg, fx) => calls.push(`explode:${r}:${dmg}:${fx}`),
    nearestEnemies: (n) => Array.from({ length: n }, (_, i) => ({ x: 10 * (i + 1), y: 0 })),
    densestPoint: () => ({ x: 100, y: 0 }),
    damageLine: (_f, _t, w, dmg, kb) => calls.push(`line:${w}:${dmg}:${kb}`),
    stunArea: (_a, r, ms) => calls.push(`stun:${r}:${ms}`),
    heal: (pct) => calls.push(`heal:${pct}`),
    hurtPlayer: (pct, ms) => calls.push(`hurt:${pct}:${ms}`),
    addBuff: (id, mods, ms) => buffs.push({ id, mods, ms }),
    marker: (_a, r, ms) => calls.push(`marker:${r}:${ms}`),
    schedule: (_d, fn) => fn(),
    flashEnemiesOnScreen: () => calls.push('flash'),
    toast: () => undefined,
    cards: {
      primeIntel: () => calls.push('primeIntel'),
      penalty: (v, n) => calls.push(`penalty:${v}:${n}`),
      grantOp: (n) => calls.push(`op:${n}`),
      shuffleHand: () => calls.push('shuffle'),
    },
    progression: { bonus: (b) => bonus.push(b), addRerolls: (n) => calls.push(`rerolls:${n}`) },
    addTp: (n) => calls.push(`tp:${n}`),
    clearDisruption: () => false,
  };
  return { ctx, calls, buffs, bonus };
}

describe('효과 레지스트리', () => {
  it('카드 24장과 실패 잔효의 효과 ID가 모두 등록돼 있다', () => {
    const ids = Object.keys(CARDS);
    expect(ids).toHaveLength(24);
    for (const id of ids) expect(EFFECTS[CARDS[id]?.effect ?? ''], id).toBeTypeOf('function');
    for (const [tag, r] of Object.entries(RESIDUE)) expect(EFFECTS[r.effect], tag).toBeTypeOf('function');
  });

  it('모든 카드·잔효 효과가 가짜 전투에서 오류 없이 돈다', () => {
    for (const def of Object.values(CARDS)) {
      const { ctx } = fakeCtx();
      expect(runEffect(def.effect, ctx, def.params, 2)).toBe(true);
    }
    for (const r of Object.values(RESIDUE)) expect(runEffect(r.effect, fakeCtx().ctx, r.params)).toBe(true);
    expect(runEffect('없는효과', fakeCtx().ctx, {})).toBe(false);
  });

  it('포격은 예고 마커 뒤 폭발하고, 위력(power)이 피해에 곱해진다', () => {
    const { ctx, calls } = fakeCtx();
    const p = CARDS.P05?.params ?? {};
    runEffect('strikes', ctx, p, 2);
    expect(calls).toEqual([`marker:${p.radius}:${p.delayMs}`, `explode:${p.radius}:${(p.damage as number) * 2}:${p.fx}`]);
  });

  it('버프는 power만큼 값이 커지고 두 번째 수정자(stat2)도 건다', () => {
    const { ctx, buffs } = fakeCtx();
    runEffect('buff', ctx, CARDS.M04?.params ?? {}, 2);
    expect(buffs[0]?.id).toBe('dud');
    expect(buffs[0]?.mods).toEqual([
      { stat: 'comboPower', op: 'mul', value: -0.6 },
      { stat: 'comboDelayMs', op: 'add', value: 4000 },
    ]);
  });

  it('다음 레벨업 카드는 보정만 넘긴다(참모 회의 4지선다 등)', () => {
    for (const id of ['P12', 'P13', 'P14']) {
      const { ctx, bonus } = fakeCtx();
      runEffect('nextLevelUp', ctx, CARDS[id]?.params ?? {});
      expect(Object.keys(bonus[0] ?? {}).length, id).toBeGreaterThan(0);
    }
  });
});

describe('시간제 버프', () => {
  it('같은 id는 겹치지 않고 새 값·새 지속시간으로 바뀌며, 만료되면 빠진다', () => {
    const b = new Buffs();
    b.add('frost', [{ stat: 'moveSpeed', op: 'mul', value: -0.2 }], 1000, 0);
    b.add('frost', [{ stat: 'moveSpeed', op: 'mul', value: -0.4 }], 1000, 500);
    expect(b.list).toHaveLength(1);
    expect(applyMods({ moveSpeed: 100 }, b.mods()).moveSpeed).toBeCloseTo(60);
    expect(b.expire(1400)).toBe(false);
    expect(b.remaining('frost', 1400)).toBe(100);
    expect(b.expire(1500)).toBe(true);
    expect(b.mods()).toEqual([]);
  });

  it('하나만 해제할 수 있다', () => {
    const b = new Buffs();
    b.add('a', [], 1000, 0);
    b.add('b', [], 1000, 0);
    expect(b.remove('a')).toBe(true);
    expect(b.remove('a')).toBe(false);
    expect(b.has('b')).toBe(true);
  });
});

describe('카드 상태 효과', () => {
  const DATA: CardData = { cards: CARDS, combos: combosData.combos as ComboDef[], rules: rulesData as unknown as CardRules };
  const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 3, minusChance: 0, ...over });
  const withHand = (ids: string[], over: Partial<CardState> = {}): CardState => {
    const { state } = createCardState(['P01', 'P02', 'P03'], DATA, env({ handSize: 0 }), createRng(0));
    const hand: CardInstance[] = ids.map((id, i) => ({ uid: 100 + i, id, drawnAtMs: 0, disguised: false }));
    return { ...state, hand, ...over };
  };

  it('OP 지급은 필요 OP에 닿으면 인장으로 바뀐다', () => {
    const r = cardStep(withHand([], { op: 2 }), { type: 'grantOp', amount: 2 }, env(), createRng(1), DATA);
    expect(r.state.seals).toBe(1);
    expect(r.state.op).toBe(1);
    expect(r.events.map((e) => e.type)).toContain('sealGained');
  });

  it('콤보 보급: 손패에 자리가 있으면 1장, 가득이면 OP +1', () => {
    const room = cardStep(withHand(['P01']), { type: 'drawNow' }, env(), createRng(1), DATA);
    expect(room.state.hand).toHaveLength(2);
    const full = cardStep(withHand(['P01', 'P01', 'P01', 'P01', 'P01']), { type: 'drawNow' }, env(), createRng(1), DATA);
    expect(full.state.hand).toHaveLength(5);
    expect(full.state.op).toBe(1);
  });

  it('통신 복구는 가장 먼저 걸린 성공률 감소를 하나 푼다', () => {
    let s = withHand([]);
    s = cardStep(s, { type: 'penalty', value: 0.1, submits: 3 }, env(), createRng(1), DATA).state;
    s = cardStep(s, { type: 'penalty', value: 0.2, submits: 3 }, env(), createRng(1), DATA).state;
    s = cardStep(s, { type: 'clearPenalty' }, env(), createRng(1), DATA).state;
    expect(s.penalties).toEqual([{ value: 0.2, submits: 3 }]);
  });
});
