import { describe, expect, it } from 'vitest';
import stagesData from '../src/data/stages.json';
import enemies from '../src/data/enemies.json';
import timelines from '../src/data/timelines.json';
import { Disruptions } from '../src/core/disruptions';
import type { StageDef } from '../src/core/stage';

const S10 = stagesData.stages.S10 as unknown as StageDef & { disruptionPolicy?: string };
const RULES = stagesData.rules;

describe('함경도·최종 보스(D36)', () => {
  it('동시 방해 상한: 3개를 요청하면 2개만 활성(카드 가림은 1개)', () => {
    const d = new Disruptions(RULES.maxDisruptions, RULES.maxCardObscuring);
    expect(d.add({ type: 'blizzard', category: 'a', source: 'stage', priority: 2, durationSec: 40 }, 0)).toBe(true);
    expect(d.add({ type: 'weather', category: 'b', source: 'stage', priority: 3, durationSec: 60 }, 0)).toBe(true);
    d.add({ type: 'supplyCut', category: 'b', source: 'stage', priority: 1, durationSec: 30 }, 0);
    expect(d.active).toHaveLength(2);
    expect(d.add({ type: 'smoke', category: 'a', source: 'stage', priority: 1, durationSec: 10 }, 0)).toBe(false);
    expect(d.active.filter((a) => a.category === 'a')).toHaveLength(1);
  });

  it('혹한은 상시 환경(방해 표에 없음, 지형 태그), 눈보라·악천후 교대 결정이 데이터에 기록', () => {
    expect(S10.environment?.mods.every((m) => m.tag === 'terrain')).toBe(true);
    expect(S10.disruptions.map((d) => d.type).sort()).toEqual(['blizzard', 'weather']);
    expect(S10.disruptionPolicy).toContain('최대 2개');
  });

  it('최종 보스 패턴 4개, 그중 하나는 이전 보스 패턴 조합(combo), AS12는 기존 3 타임라인 동시', () => {
    const e50 = enemies.enemies.E50 as { attacks: { type: string; parts?: { type: string }[] }[] };
    expect(e50.attacks).toHaveLength(4);
    const combo = e50.attacks.find((a) => a.type === 'combo');
    expect(combo?.parts?.map((p) => p.type)).toEqual(['barricade', 'lob']);
    const as12 = (timelines.timelines as Record<string, { with?: string[] }>).AS12;
    expect(as12?.with).toHaveLength(3);
    for (const id of as12?.with ?? []) expect(timelines.timelines).toHaveProperty(id);
  });
});
