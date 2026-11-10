import { describe, expect, it } from 'vitest';
import stagesData from '../src/data/stages.json';
import disruptions from '../src/data/disruptions.json';
import skills from '../src/data/skills.json';
import { takeBurst } from '../src/core/spawnLogic';
import { StageDirector, type StageDef, type StageEvent } from '../src/core/stage';

const S7 = stagesData.stages.S7 as unknown as StageDef;

describe('대규모 군집·보급선 차단·컷인(D33)', () => {
  it('군집 대기열: 상한(room)이 우선, 남은 수는 다음에', () => {
    const q = [{ id: 'E31', left: 40, angle: 1, arcRad: 1 }];
    const a = takeBurst(q, 25);
    expect(a.spawn).toHaveLength(25);
    expect(a.queue).toEqual([{ id: 'E31', left: 15, angle: 1, arcRad: 1 }]);
    const b = takeBurst(a.queue, 100);
    expect(b.spawn).toHaveLength(15);
    expect(b.queue).toEqual([]);
    expect(takeBurst(q, 0).spawn).toHaveLength(0);
  });

  it('스테이지 7: 군집 예고 → 등장 한 번씩', () => {
    const d = new StageDirector(S7);
    const first = S7.bursts?.[0];
    if (!first) throw new Error('bursts');
    const evs: StageEvent[] = [];
    for (let t = 0; t <= first.at + 1; t += 0.5) evs.push(...d.update(t, 1, { enemiesOnScreen: 30 }));
    expect(evs.filter((e) => e.type === 'burstWarn')).toHaveLength(1);
    const b = evs.filter((e) => e.type === 'burst');
    expect(b).toHaveLength(1);
    expect(b[0]?.type === 'burst' && b[0].burst.count).toBe(first.count);
  });

  it('보급선 차단은 드로우 −50%, 컷인은 F 슬롯 궁극기에만', () => {
    expect(disruptions.types.supplyCut.drawMul).toBe(0.5);
    const S = skills.skills as Record<string, { slot: string; cutIn?: boolean }>;
    for (const [id, s] of Object.entries(S)) expect(Boolean(s.cutIn), id).toBe(s.slot === 'F');
    expect(skills.cutInMs).toBe(300);
  });
});
