import { describe, expect, it } from 'vitest';
import guideData from '../src/data/guide.json';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import stagesData from '../src/data/stages.json';
import npcData from '../src/data/npcs.json';
import { Guide, type GuideState } from '../src/core/guide';
import { cardStep, createCardState, type CardData, type CardEnv, type CardInstance, type CardRules } from '../src/core/cards';
import type { ComboDef } from '../src/core/combos';
import { matchCombo } from '../src/core/combos';
import { StageDirector, type StageDef } from '../src/core/stage';
import { EFFECTS } from '../src/systems/effects';
import { createRng } from '../src/core/rng';

const DATA: CardData = { cards: cardsData.cards as unknown as CardData['cards'], combos: combosData.combos as ComboDef[], rules: rulesData as unknown as CardRules };
const env: CardEnv = { nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0 };
const hand = (ids: string[]) => {
  const { state } = createCardState([], DATA, env, createRng(0));
  return { ...state, hand: ids.map((id, i): CardInstance => ({ uid: i + 1, id, drawnAtMs: 0, disguised: false })), nextUid: ids.length + 1 };
};

describe('첫 플레이 가이드', () => {
  it('PRD §5.2의 팁 8개 + 질주 안내 1개, 상황마다 처음 한 번만, 저장으로 넘김', () => {
    expect(Object.keys(guideData.tips)).toHaveLength(9);
    let saved: GuideState | null = null;
    const g = new Guide(guideData.tips, { enabled: true, seen: [] }, (s) => (saved = s));
    expect(g.trigger('move')).toBe(guideData.tips.move);
    expect(g.trigger('move')).toBeNull();
    expect(saved).toEqual({ enabled: true, seen: ['move'] });
    const again = new Guide(guideData.tips, saved as unknown as GuideState, () => undefined);
    expect(again.trigger('move')).toBeNull();
    expect(again.progress).toEqual({ seen: 1, total: 9 });
  });

  it('이미 스스로 한 행동은 팁 없이 본 것으로(뒤늦은 안내 없음)', () => {
    let saved: unknown = null;
    const g = new Guide(guideData.tips, { enabled: true, seen: [] }, (s) => (saved = s));
    g.skip('skillReady');
    expect(g.has('skillReady')).toBe(true);
    expect(g.trigger('skillReady')).toBeNull();
    expect(saved).toEqual({ enabled: true, seen: ['skillReady'] });
  });

  it('설정에서 끄면 아무 팁도 안 나온다', () => {
    const g = new Guide(guideData.tips, { enabled: false, seen: [] }, () => undefined);
    expect(g.trigger('firstCard')).toBeNull();
  });

  it('연습 짝은 공군+정보(정밀 폭격)이고, 연습 제출은 확정 성공(인장 안 씀)', () => {
    const [a = '', b = ''] = guideData.practicePair;
    const tags = guideData.practicePair.map((id) => ({ uid: 0, tag: DATA.cards[id]?.tag ?? '' }));
    expect(tags.map((t) => t.tag).sort()).toEqual(['air', 'intel']);
    expect(matchCombo(tags.map((t, i) => ({ ...t, uid: i })), DATA.combos, {}, 0)?.combo.id).toBe('precision_bomb');
    // 난수가 늘 실패여도 확정 성공
    const fail = { next: () => 0.999, fork: () => fail } as unknown as ReturnType<typeof createRng>;
    const r = cardStep(hand([a, b]), { type: 'submit', uids: [1, 2], forceSuccess: true }, env, fail, DATA);
    expect(r.events.find((e) => e.type === 'judged')).toMatchObject({ success: true, seal: false });
    expect(r.state.seals).toBe(0);
  });
});

describe('NPC', () => {
  it('군의관 정화: 손패의 마이너스 카드만 사라진다', () => {
    const r = cardStep(hand(['P01', 'M01', 'P02', 'M05']), { type: 'purgeMinus' }, env, createRng(1), DATA);
    expect(r.state.hand.map((c) => c.id)).toEqual(['P01', 'P02']);
    expect(r.events.filter((e) => e.type === 'purified')).toHaveLength(2);
  });

  it('NPC 효과는 효과 레지스트리에 있고, 스테이지 npcAt마다 차례로 등장', () => {
    for (const n of Object.values(npcData.npcs)) for (const fx of n.effects) expect(EFFECTS[fx.effect], fx.effect).toBeTypeOf('function');
    const st = stagesData.stages.S1 as unknown as StageDef;
    const d = new StageDirector(st);
    const npcs: string[] = [];
    for (let t = 0; t <= 700; t += 1) for (const ev of d.update(t, 1, { enemiesOnScreen: 0 })) if (ev.type === 'npc') npcs.push(`${t}:${ev.npc}`);
    expect(npcs).toEqual(['360:N01', '600:N02']);
  });
});
