import { describe, expect, it } from 'vitest';
import sfx from '../src/data/sfx.json';
import {
  CueGate,
  VoiceTable,
  aggregateGainDb,
  comboSemitones,
  distanceGain,
  duckDb,
  panFromX,
  semitonesToRate,
  stateTargets,
  type StateRule,
} from '../src/core/audioMix';
import { layerLengthMs, synthesize, type SynthLayer } from '../src/core/synth';
import { createRng } from '../src/core/rng';

describe('합성기', () => {
  const layers: SynthLayer[] = [
    { wave: 'noise', freq: 6000, releaseMs: 45, volume: 0.7, lowpassHz: 2600 },
    { wave: 'square', freq: 330, freqEnd: 130, releaseMs: 70, duty: 0.3, crush: 5 },
  ];

  it('길이는 가장 긴 겹, 최대 진폭은 peak, 시작부터 소리(앞 무음 5ms 이하)', () => {
    const out = synthesize(layers, 44100, () => 0.5, 1, 0.9);
    expect(out.length).toBe(Math.ceil((70 / 1000) * 44100));
    let max = 0;
    for (const v of out) max = Math.max(max, Math.abs(v));
    expect(max).toBeCloseTo(0.9, 5);
    const firstLoud = out.findIndex((v) => Math.abs(v) > 0.05);
    expect(firstLoud).toBeLessThan(44100 * 0.005);
  });

  it('같은 시드면 같은 소리(노이즈 포함)', () => {
    const a = synthesize(layers, 22050, ((r) => () => r.next())(createRng('s')));
    const b = synthesize(layers, 22050, ((r) => () => r.next())(createRng('s')));
    expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)));
  });

  it('sfx.json의 모든 소리가 합성되고 길이 3초 미만', () => {
    for (const [name, src] of Object.entries(sfx.sources)) {
      const ls = src.layers as SynthLayer[];
      expect(Math.max(...ls.map(layerLengthMs)), name).toBeLessThan(3000);
      const out = synthesize(ls, 8000, () => 0.3);
      expect(out.length, name).toBeGreaterThan(0);
      expect(out.every((v) => Number.isFinite(v)), name).toBe(true);
    }
  });

  it('모든 cue가 있는 소리를 가리키고 버스가 정의돼 있다', () => {
    for (const [name, c] of Object.entries(sfx.cues)) {
      expect(Object.keys(sfx.sources), name).toContain(c.src);
      expect(Object.keys(sfx.buses), name).toContain(c.bus);
    }
  });
});

describe('믹싱 규칙', () => {
  it('반음 → 배율, 콤보 5음 음계(최대 1옥타브)', () => {
    expect(semitonesToRate(12)).toBeCloseTo(2);
    expect(semitonesToRate(-12)).toBeCloseTo(0.5);
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => comboSemitones(n, 12))).toEqual([0, 2, 4, 7, 9, 12, 12]);
  });

  it('팬·거리: 화면 안 1, 화면 1.2배 밖 0', () => {
    expect(panFromX(480, 480, 480, 0.6)).toBe(0);
    expect(panFromX(960, 480, 480, 0.6)).toBeCloseTo(0.6);
    expect(panFromX(-500, 480, 480, 0.6)).toBeCloseTo(-0.6);
    expect(distanceGain(100, 50, 480, 270, 1.2)).toBe(1);
    expect(distanceGain(480 * 1.1, 0, 480, 270, 1.2)).toBeCloseTo(0.5);
    expect(distanceGain(480 * 1.3, 0, 480, 270, 1.2)).toBe(0);
  });

  it('같은 프레임 합치기: +min(6dB, 3·log2 n)', () => {
    expect(aggregateGainDb(1)).toBe(0);
    expect(aggregateGainDb(2)).toBe(3);
    expect(aggregateGainDb(100)).toBe(6);
  });

  it('보이스: 소리별 상한이면 가장 오래된 것을, 전체 상한이면 우선순위 낮은 것을 끊음', () => {
    const v = new VoiceTable(3);
    const a = v.add('hit', 1, 0, 500);
    v.add('hit', 1, 10, 500);
    expect(v.decide('hit', 1, 2, 20)).toEqual({ action: 'steal', id: a });
    v.add('kill', 2, 20, 500);
    expect(v.decide('boom', 9, 2, 30)).toEqual({ action: 'steal', id: a });
    expect(v.decide('ui', 0, 2, 30)).toEqual({ action: 'drop' });
    expect(v.decide('hit', 1, 2, 600)).toEqual({ action: 'play' }); // 끝난 소리는 정리
  });

  it('재생 간격: 막힌 요청 중 같은 프레임 것만 합친다', () => {
    const g = new CueGate();
    expect(g.check('hit', 0, 35, 1).ok).toBe(true);
    expect(g.check('hit', 5, 35, 1)).toEqual({ ok: false, sameFrame: true, count: 2 });
    expect(g.check('hit', 20, 35, 2)).toEqual({ ok: false, sameFrame: false, count: 2 });
    expect(g.check('hit', 40, 35, 3).ok).toBe(true);
  });

  it('덕킹 곡선과 시간 상태(일시정지·슬로모 겹치면 더 깊은 쪽)', () => {
    const d = { db: -9, attackMs: 20, holdMs: 200, releaseMs: 700 };
    expect(duckDb(d, 10)).toBeCloseTo(-4.5);
    expect(duckDb(d, 100)).toBe(-9);
    expect(duckDb(d, 570)).toBeCloseTo(-4.5);
    expect(duckDb(d, 1000)).toBe(0);
    const rules = sfx.states as Record<string, StateRule>;
    const none = stateTargets({ paused: false, slowmo: false, judge: false }, rules);
    expect(none.sfxDb).toBe(0);
    const both = stateTargets({ paused: true, slowmo: true, judge: false }, rules);
    expect(both.sfxDb).toBe(-60);
    expect(both.sfxLpfHz).toBe(3000);
    expect(both.bgmDb).toBe(-10);
    expect(both.newPitchSt).toBe(-2);
  });
});
