import { describe, expect, it } from 'vitest';
import sfxData from '../src/data/sfx.json';
import timelinesData from '../src/data/timelines.json';
import cuesData from '../src/data/cues.json';
import { synthesize, type SynthLayer } from '../src/core/synth';
import { encodeWav, leadingSilenceMs, normalize, peak, trimLeading } from '../src/core/wav';
import { createRng } from '../src/core/rng';
import { createManifest } from '../src/assets/manifest';
import { MARKER_CUE, expandTimeline, type TimelineDef } from '../src/core/timeline';

const SR = 22050;
const SOURCES = sfxData.sources as Record<string, { layers: SynthLayer[] }>;

describe('효과음 굽기(bake)', () => {
  it('모든 합성음: 피크 −1dB, 앞 무음 5ms 이하, 길이 0.02~3초, WAV 크기 일치', () => {
    for (const [name, src] of Object.entries(SOURCES)) {
      const rng = createRng(name);
      const raw = synthesize(src.layers, SR, () => rng.next());
      const data = normalize(trimLeading(raw, SR), -1);
      expect(20 * Math.log10(peak(data)), name).toBeCloseTo(-1, 1);
      expect(leadingSilenceMs(data, SR), name).toBeLessThanOrEqual(5);
      const sec = data.length / SR;
      expect(sec, name).toBeGreaterThan(0.02);
      expect(sec, name).toBeLessThan(3);
      const wav = encodeWav(data, SR);
      expect(wav.length).toBe(44 + data.length * 2);
      expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    }
  });

  it('앞 무음이 긴 소리는 5ms만 남기고 자른다', () => {
    const d = new Float32Array(SR);
    d.fill(0.5, SR / 2);
    expect(leadingSilenceMs(d, SR)).toBeCloseTo(500, 0);
    expect(leadingSilenceMs(trimLeading(d, SR), SR)).toBeCloseTo(5, 0);
  });
});

describe('소리 파일 덮어쓰기', () => {
  it('audio/<이름>.ogg|mp3가 있으면 그 파일, 없으면 변형 _1·_2, 하나도 없으면 빈 목록(합성음)', () => {
    const m = createManifest(['audio/shot.ogg', 'audio/shot.mp3', 'audio/hit_1.ogg', 'audio/hit_2.ogg', 'audio/bgm_boss.mp3']);
    expect(m.audio('shot')).toEqual([{ key: 'audio_shot', urls: expect.arrayContaining([expect.stringMatching(/shot\.ogg$/), expect.stringMatching(/shot\.mp3$/)]) }]);
    expect(m.audio('hit').map((a) => a.key)).toEqual(['audio_hit_1', 'audio_hit_2']);
    expect(m.audio('kill')).toEqual([]);
    expect(m.audio('bgm_boss')).toHaveLength(1);
  });
});

describe('휘슬 끝 정렬', () => {
  it('휘슬 큐의 예고 마커는 뒤따를 착탄 큐를 안다(착탄 시각 − 소리 길이에 시작)', () => {
    const cues = cuesData.cues as Record<string, { whistle?: boolean }>;
    const tl = timelinesData.timelines as unknown as Record<string, TimelineDef>;
    const out = expandTimeline(tl.precision_bomb as TimelineDef, { aim: { x: 0, y: 0 }, player: { x: 0, y: 0 } }, () => 0.5);
    const marker = out.find((e) => e.cue === MARKER_CUE);
    expect(marker?.for).toBe('bomb_impact_l');
    expect(cues[marker?.for ?? '']?.whistle).toBe(true);
    // 시한폭탄 폭발은 휘슬 없음
    expect(cues.timebomb_blast?.whistle).toBeUndefined();
  });
});
