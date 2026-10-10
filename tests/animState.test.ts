import { describe, expect, it } from 'vitest';
import animations from '../src/data/animations.json';
import { createAnimState, locomotionFor, oneShotDurationMs, triggerAction, updateAnimState, type AnimRules } from '../src/core/animState';

const ally = animations.ally as AnimRules;
const still = { moving: false, speedRatio: 1 };
const run = { moving: true, speedRatio: 1 };

describe('animState (PRD §4.3)', () => {
  it('정지 → 대기, 이동 속도 50% 미만 → 느린 이동, 그 이상 → 빠른 이동', () => {
    expect(locomotionFor(ally, still)).toBe('idle');
    expect(locomotionFor(ally, { moving: true, speedRatio: 0.4 })).toBe('move_slow');
    expect(locomotionFor(ally, { moving: true, speedRatio: 0.5 })).toBe('move_fast');
    expect(locomotionFor(ally, run)).toBe('move_fast');
  });

  it('이동 상태가 바뀔 때만 시작 시각이 갱신된다', () => {
    let s = createAnimState(ally, 0);
    s = updateAnimState(s, ally, run, 100);
    expect([s.current, s.startedMs]).toEqual(['move_fast', 100]);
    const same = updateAnimState(s, ally, run, 200);
    expect(same).toBe(s);
    s = updateAnimState(s, ally, still, 300);
    expect([s.current, s.startedMs]).toEqual(['idle', 300]);
  });

  it('한 번 재생 동작은 재생 시간 동안 이동 동작보다 우선하고 끝나면 이동 동작으로 돌아간다', () => {
    let s = updateAnimState(createAnimState(ally, 0), ally, run, 0);
    s = triggerAction(s, ally, 'attack', 6, 1000);
    const dur = oneShotDurationMs(ally.actions.attack!, 6); // 6/16초 = 375ms
    expect(dur).toBe(375);
    expect(updateAnimState(s, ally, run, 1000 + dur - 1).current).toBe('attack');
    expect(updateAnimState(s, ally, run, 1000 + dur).current).toBe('move_fast');
  });

  it('최소 재생 시간: 치명타 0.3초, 스킬 0.4초', () => {
    expect(oneShotDurationMs(ally.actions.crit!, 2)).toBe(300);
    expect(oneShotDurationMs(ally.actions.skill!, 2)).toBe(400);
    expect(oneShotDurationMs(ally.actions.skill!, 6)).toBe(500); // 프레임이 더 길면 프레임 기준
  });

  it('우선순위: 높은 동작은 낮은 동작을 끊고, 낮은 동작은 높은 동작 중에 무시된다', () => {
    let s = triggerAction(createAnimState(ally, 0), ally, 'attack', 6, 0);
    s = triggerAction(s, ally, 'crit', 6, 100);
    expect(s.current).toBe('crit');
    const ignored = triggerAction(s, ally, 'attack', 6, 150);
    expect(ignored).toBe(s);
    // 치명타가 끝난 뒤에는 공격이 다시 가능
    const later = triggerAction(s, ally, 'attack', 6, 100 + 400);
    expect(later.current).toBe('attack');
  });

  it('같은 동작을 다시 트리거하면 처음부터 다시 재생(시작 시각 갱신)', () => {
    const a = triggerAction(createAnimState(ally, 0), ally, 'attack', 6, 0);
    const b = triggerAction(a, ally, 'attack', 6, 200);
    expect(b.startedMs).toBe(200);
  });

  it('반복 동작이나 모르는 동작은 트리거로 바뀌지 않는다', () => {
    const s = createAnimState(ally, 0);
    expect(triggerAction(s, ally, 'move_fast', 6, 10)).toBe(s);
    expect(triggerAction(s, ally, 'dance', 6, 10)).toBe(s);
  });

  it('적은 정지해도 move, NPC는 늘 idle (데이터 규칙)', () => {
    expect(locomotionFor(animations.enemy as AnimRules, still)).toBe('move');
    expect(locomotionFor(animations.npc as AnimRules, run)).toBe('idle');
  });
});
