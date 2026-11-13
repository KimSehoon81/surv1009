import { describe, expect, it } from 'vitest';
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import stagesData from '../src/data/stages.json';
import { cardStep, createCardState, minusChanceFor, type CardData, type CardEnv, type CardRules, type CardState } from '../src/core/cards';
import { recommend } from '../src/core/cardAdvisor';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';
import { StageDirector, type StageDef } from '../src/core/stage';

// 시드 고정 시뮬 스냅샷(D44 여유): 같은 시드면 같은 결과. 규칙·데이터를 바꿔 숫자가 달라지면 이 테스트가 알려 준다
// (의도한 변경이면 `npx vitest run tests/simSnapshot.test.ts -u`로 갱신하고 커밋 메시지에 이유)
const DATA: CardData = { cards: cardsData.cards as unknown as CardData['cards'], combos: combosData.combos as ComboDef[], rules: rulesData as unknown as CardRules };
const env = (now: number): CardEnv => ({ nowMs: now, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: DATA.rules.opForSeal, minusChance: minusChanceFor(1, DATA.rules) });

function cardRun(seed: string): Record<string, number> {
  const rng = createRng(seed);
  let s: CardState = createCardState(cardsData.starterDeck, DATA, env(0), rng).state;
  const r = { submits: 0, successes: 0, sealsGained: 0, sealsUsed: 0, combos: 0, longest: 0 };
  for (let t = 0; t < 15 * 60_000; t += 100) {
    s = cardStep(s, { type: 'tick', dtMs: 100 }, env(t), rng, DATA).state;
    if (t < s.cooldownUntilMs) continue;
    const a = recommend(s, env(t), DATA);
    if (!a) continue;
    const step = cardStep(s, { type: 'submit', uids: a.uids, useSeal: s.seals > 0 && a.combo !== null }, env(t), rng, DATA);
    s = step.state;
    for (const e of step.events) {
      if (e.type === 'judged') {
        r.submits++;
        if (e.success) r.successes++;
      }
      if (e.type === 'sealGained') r.sealsGained++;
      if (e.type === 'sealUsed') r.sealsUsed++;
      if (e.type === 'comboSkill') r.combos++;
    }
  }
  r.longest = s.stats.longestFailStreak;
  return r;
}

/** S1 스테이지 감독 이벤트 시간표(레벨은 1분에 1씩 오른다고 가정) */
function stageTimeline(id: string): string[] {
  const d = new StageDirector((stagesData.stages as unknown as Record<string, StageDef>)[id] as StageDef);
  const out: string[] = [];
  for (let t = 0; t <= 14 * 60; t += 1) {
    for (const ev of d.update(t, 1 + Math.floor(t / 60), { enemiesOnScreen: 30 })) {
      const who = 'enemy' in ev ? ev.enemy : 'npc' in ev ? ev.npc : 'def' in ev ? (ev.def as { type: string }).type : '';
      out.push(`${t}s ${ev.type}${who ? ` ${String(who)}` : ''}`);
    }
  }
  return out;
}

describe('시드 고정 시뮬 스냅샷(D44)', () => {
  it('카드 루프 15분(추천 바로 제출, 시드 3개)', () => {
    expect(['qa1', 'qa2', 'qa3'].map(cardRun)).toMatchSnapshot();
  });

  it('S1·S7 스테이지 이벤트 시간표', () => {
    expect({ S1: stageTimeline('S1'), S7: stageTimeline('S7') }).toMatchSnapshot();
  });
});
