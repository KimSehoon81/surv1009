import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import disruptions from '../src/data/disruptions.json';
import enemies from '../src/data/enemies.json';
import weapons from '../src/data/weapons.json';
import { cardStep, createCardState, previewSubmit, type CardData, type CardEnv, type CardInstance, type CardRules, type CardState } from '../src/core/cards';
import { recommend } from '../src/core/cardAdvisor';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';

const DATA: CardData = { cards: cardsData.cards as unknown as CardData['cards'], combos: combosData.combos as ComboDef[], rules: rulesData as unknown as CardRules };
const W = disruptions.types.weather;
const env = (over: Partial<CardEnv> = {}): CardEnv => ({ nowMs: 0, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: 10, minusChance: 0, ...over });
const weather = () => env({ blockedTags: W.blockTags, tagPenalty: W.tagPenalty });
function withHand(ids: string[]): CardState {
  const { state } = createCardState([], DATA, env(), createRng(0));
  const hand: CardInstance[] = ids.map((id, i) => ({ uid: i + 1, id, drawnAtMs: i, disguised: false }));
  return { ...state, hand };
}

describe('악천후(PRD §5.4 b, D34)', () => {
  it('공군 카드 제출은 core 검증에서 거부 이벤트(blockedTag), 카드는 손에 남음', () => {
    const s = withHand(['P04', 'P01']);
    const r = cardStep(s, { type: 'submit', uids: [1] }, weather(), createRng(1), DATA);
    const rej = r.events.find((e) => e.type === 'rejected');
    expect(rej && rej.type === 'rejected' ? rej.reason : '').toBe('blockedTag');
    expect(r.state.hand).toHaveLength(2);
    expect(previewSubmit(s, [1, 2], false, weather(), DATA)).toEqual({ ok: false, reason: 'blockedTag' });
  });

  it('해군 −10%p, 그 밖은 그대로, 추천 조합은 공군을 넣지 않음', () => {
    expect(previewSubmit(withHand(['P05']), [1], false, weather(), DATA).chance?.final).toBeCloseTo(0.2);
    expect(previewSubmit(withHand(['P01']), [1], false, weather(), DATA).chance?.final).toBeCloseTo(0.3);
    const a = recommend(withHand(['P04', 'P10', 'P01']), weather(), DATA);
    expect(a?.uids ?? []).not.toContain(1);
  });

  it('MiG는 공중 유닛, 대공 무기는 기관총·BAR', () => {
    expect((enemies.enemies.E38 as { air?: boolean }).air).toBe(true);
    const aa = Object.entries(weapons.weapons).filter(([, w]) => (w as { antiAir?: boolean }).antiAir).map(([id]) => id).sort();
    expect(aa).toEqual(['bar', 'mg']);
  });
});

describe('포위망·순간 돌파(D35)', () => {
  it('포위망은 엘리트 근위연대가 거는 방해(스폰 +50%·이동 −10%), 특수부대 대시는 chargeDash 수치만(예고 0.6초)', () => {
    expect(disruptions.types.encircle).toMatchObject({ spawnMul: 1.5, playerSpeedMul: 0.9 });
    const e44 = enemies.enemies.E44 as { tier: string; disrupt?: { type: string } };
    expect(e44.tier).toBe('elite');
    expect(e44.disrupt?.type).toBe('encircle');
    const dash = (enemies.enemies.E42.attacks as { type: string; telegraphMs?: number }[])[0];
    expect(dash).toMatchObject({ type: 'chargeDash', telegraphMs: 600 });
    expect((enemies.enemies.E43 as { antiAir?: boolean }).antiAir).toBe(true);
  });
});
