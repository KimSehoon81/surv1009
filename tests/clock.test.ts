import { describe, expect, it } from 'vitest';
import { FRAME_MS, GameClock, MAX_REAL_DELTA_MS } from '../src/systems/clock';

describe('GameClock', () => {
  it('기본 배율 1, 누적 시간 증가', () => {
    const c = new GameClock();
    expect(c.tick(16)).toBe(16);
    expect(c.timeMs).toBe(16);
  });

  it('큰 delta는 상한으로 자른다(탭 전환 대비)', () => {
    const c = new GameClock();
    expect(c.tick(5000)).toBe(MAX_REAL_DELTA_MS);
    expect(c.tick(-5)).toBe(0);
  });

  it('pause/resume은 같은 키로만 풀린다', () => {
    const c = new GameClock();
    c.pause();
    c.pause('levelup');
    expect(c.tick(16)).toBe(0);
    c.resume();
    expect(c.tick(16)).toBe(0); // levelup이 아직 남아 있음
    c.resume('levelup');
    expect(c.tick(16)).toBe(16);
  });

  it('여러 슬로모가 겹치면 가장 느린 배율, 지속시간은 실시간 기준으로 끝난다', () => {
    const c = new GameClock();
    c.setScale('cardJudge', 0.3, 600);
    c.setScale('bossKill', 0.5, 100);
    expect(c.tick(50)).toBeCloseTo(15); // min(0.3, 0.5)
    c.clearScale('cardJudge');
    expect(c.tick(50)).toBeCloseTo(25); // bossKill만 남음(100ms 중 50 경과 후)
    expect(c.hasScale('bossKill')).toBe(false); // 100ms 소진
    expect(c.tick(50)).toBe(50);
  });

  it('카드 판정 0.3배 0.6초: 실시간 600ms 동안 전투 시간 180ms', () => {
    const c = new GameClock();
    c.setScale('cardJudge', 0.3, 600);
    let battle = 0;
    for (let i = 0; i < 36; i++) battle += c.tick(600 / 36);
    expect(battle).toBeCloseTo(180, 5);
    expect(c.hasScale('cardJudge')).toBe(false);
    expect(c.tick(10)).toBe(10);
  });

  it('히트스톱은 중첩하지 않고 큰 값만 유지(PRD §4.4)', () => {
    const c = new GameClock();
    c.hitstop(5);
    c.hitstop(2); // 더 짧은 요청은 무시
    expect(c.scale).toBe(0);
    let flowed = 0;
    for (let i = 0; i < 5; i++) flowed += c.tick(FRAME_MS);
    expect(flowed).toBeCloseTo(0, 6);
    expect(c.tick(FRAME_MS)).toBeCloseTo(FRAME_MS);
  });

  it('히트스톱이 프레임 중간에 끝나면 남은 시간은 흐른다', () => {
    const c = new GameClock();
    c.hitstop(1); // 16.67ms
    expect(c.tick(20)).toBeCloseTo(20 - FRAME_MS);
  });

  it('히트스톱과 슬로모가 함께면 히트스톱이 끝난 뒤 슬로모 적용', () => {
    const c = new GameClock();
    c.setScale('slowmo', 0.3, 1000);
    c.hitstop(2);
    expect(c.tick(2 * FRAME_MS)).toBeCloseTo(0);
    expect(c.tick(100)).toBeCloseTo(30);
  });

  it('잘못된 배율은 거부, 0 이하 지속시간은 해제', () => {
    const c = new GameClock();
    expect(() => c.setScale('x', -1)).toThrow();
    expect(() => c.setScale('x', Number.NaN)).toThrow();
    c.setScale('x', 0.5);
    c.setScale('x', 0.5, 0);
    expect(c.hasScale('x')).toBe(false);
  });

  it('reset은 모든 상태를 지운다', () => {
    const c = new GameClock();
    c.pause();
    c.hitstop(10);
    c.tick(16);
    c.reset();
    expect(c.timeMs).toBe(0);
    expect(c.tick(16)).toBe(16);
  });
});
