import { describe, expect, it } from 'vitest';
import data from '../src/data/achievements.json';
import { addSeen, applyEvent, emptyAchievements, emptyCodex, progressOf, type AchievementDef } from '../src/core/achievements';

const DEFS = data.achievements as AchievementDef[];
const def = (id: string) => DEFS.find((d) => d.id === id) as AchievementDef;
const run = (evs: { type: string; [k: string]: string | number | boolean }[]) => {
  let s = emptyAchievements();
  const got: string[] = [];
  for (const e of evs) {
    const r = applyEvent(s, e, DEFS);
    s = r.state;
    got.push(...r.unlocked.map((u) => u.id));
  }
  return { s, got };
};

describe('업적 판정(D41)', () => {
  it('업적 15~20개, ID 겹침 없음, 목표 양수', () => {
    expect(DEFS.length).toBeGreaterThanOrEqual(15);
    expect(DEFS.length).toBeLessThanOrEqual(20);
    expect(new Set(DEFS.map((d) => d.id)).size).toBe(DEFS.length);
    for (const d of DEFS) expect(d.target).toBeGreaterThan(0);
  });

  it('처치: 첫 처치는 한 번만 달성, 누적은 계속 세고 진행도 표시', () => {
    const { s, got } = run([{ type: 'kill', tier: 'normal', enemy: 'E01' }, { type: 'kill', tier: 'normal', enemy: 'E01' }]);
    expect(got).toEqual(['first_kill']);
    expect(s.counters.kill_1000).toBe(2);
    expect(progressOf(s, def('kill_1000'))).toBeCloseTo(0.002);
    expect(progressOf(s, def('first_kill'))).toBe(1);
  });

  it('where·distinct: 같은 보스를 여러 번 잡아도 서로 다른 보스 수는 1', () => {
    const { s, got } = run([{ type: 'kill', tier: 'boss', enemy: 'E05' }, { type: 'kill', tier: 'boss', enemy: 'E05' }, { type: 'kill', tier: 'boss', enemy: 'E10' }]);
    expect(got).toContain('boss_1');
    expect(s.counters.boss_all).toBe(2);
    expect(s.sets.boss_all).toEqual(['E05', 'E10']);
  });

  it('min·max: 12분 안 점령·위협 등급 점령·연속 실패 뒤 성공', () => {
    expect(run([{ type: 'capture', stage: 'S1', timeSec: 800, threat: 0 }]).got).toEqual(['capture_1']);
    expect(run([{ type: 'capture', stage: 'S1', timeSec: 700, threat: 1 }]).got.sort()).toEqual(['capture_1', 'fast_capture', 'threat_capture'].sort());
    expect(run([{ type: 'cardJudged', success: true, combo: false, seal: false, gamble: false, failStreak: 4 }]).got).toEqual([]);
    expect(run([{ type: 'cardJudged', success: true, combo: false, seal: false, gamble: false, failStreak: 5 }]).got).toEqual(['streak_breaker']);
  });

  it('도감: 본 ID를 한 번만 더함', () => {
    let c = emptyCodex();
    c = addSeen(c, 'enemies', 'E01');
    expect(addSeen(c, 'enemies', 'E01')).toBe(c);
    expect(addSeen(c, 'cards', 'P01').cards).toEqual(['P01']);
  });
});
