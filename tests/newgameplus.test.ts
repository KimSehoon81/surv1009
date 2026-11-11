import { describe, expect, it } from 'vitest';
import scaling from '../src/data/scaling.json';
import { enemyScale, globalStep, threatReward } from '../src/core/scaling';
import { startNewGamePlus } from '../src/core/meta';
import { defaultSave } from '../src/core/save';

describe('위협 등급·뉴게임+·전역 단계(D38)', () => {
  it('위협 등급이 오를수록 적 체력·공격과 전공 보상이 단조 증가(밀도는 그대로)', () => {
    let prev = enemyScale(5, 5, 0);
    let prevR = threatReward(0);
    expect(prevR).toBe(1);
    for (let t = 1; t <= scaling.threat.max; t++) {
      const s = enemyScale(5, 5, t);
      expect(s.hp).toBeGreaterThan(prev.hp);
      expect(s.attack).toBeGreaterThan(prev.attack);
      expect(s.density).toBe(prev.density);
      expect(threatReward(t)).toBeGreaterThan(prevR);
      prev = s;
      prevR = threatReward(t);
    }
    expect(threatReward(scaling.threat.max + 5)).toBe(threatReward(scaling.threat.max));
  });

  it('뉴게임+: 엔딩 전에는 거부, 뒤에는 위협 +1·점령만 초기화(기록·해금·강화·전공 유지), 최대에서 거부', () => {
    const base = defaultSave();
    base.stages = { S1: { captured: true, clears: 2, bestTimeSec: 600 }, S10: { captured: true, clears: 1 } };
    base.unlocks.chars.push('A30');
    base.startUpgrades = { startHand: 1 };
    base.merit = 777;
    expect(startNewGamePlus(base, 10)).toEqual({ ok: false, error: 'noEnding' });
    const seen = { ...base, flags: { ...base.flags, endingSeen: true } };
    const r = startNewGamePlus(seen, 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.threat).toBe(1);
    expect(r.save.stages.S1).toEqual({ captured: false, clears: 2, bestTimeSec: 600 });
    expect(r.save.unlocks.chars).toContain('A30');
    expect(r.save.startUpgrades).toEqual({ startHand: 1 });
    expect(r.save.merit).toBe(777);
    expect(startNewGamePlus({ ...seen, threat: 10 }, 10)).toEqual({ ok: false, error: 'max' });
  });

  it('전역 단계 N = (스테이지−1)×10 + Lv', () => {
    expect(globalStep(1, 1)).toBe(1);
    expect(globalStep(3, 7)).toBe(27);
    expect(globalStep(10, 10)).toBe(100);
  });
});
