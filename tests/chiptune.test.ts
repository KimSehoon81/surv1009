import { describe, expect, it } from 'vitest';
import music from '../src/data/music.json';
import sfx from '../src/data/sfx.json';
import { noteFreq, renderSong, songSteps, stepSec, type Song } from '../src/core/chiptune';

const SONGS = music.songs as unknown as Record<string, Song>;

describe('칩튠 렌더러(레트로 음악)', () => {
  it('음이름 → 주파수', () => {
    expect(noteFreq('A4')).toBeCloseTo(440);
    expect(noteFreq('A5')).toBeCloseTo(880);
    expect(noteFreq('C#5')).toBeCloseTo(554.37, 1);
    expect(noteFreq('.')).toBeNull();
    expect(noteFreq('-')).toBeNull();
  });

  it('모든 곡: bgm 트랙 이름이 있고, 마디 칸 수가 맞고, 길이 = 마디 × 박자, 소리 범위 안·같은 시드면 같은 결과', () => {
    for (const [name, song] of Object.entries(SONGS)) {
      expect(sfx.bgm.tracks, name).toHaveProperty(name);
      const sr = 8000;
      const a = renderSong(song, sr, 7);
      expect(a.length, name).toBe(Math.round(songSteps(song) * stepSec(song) * sr));
      let peak = 0;
      let energy = 0;
      for (const v of a) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
      expect(peak, name).toBeLessThanOrEqual(1);
      expect(energy / a.length, name).toBeGreaterThan(0.005);
      expect(renderSong(song, sr, 7)).toEqual(a);
    }
  });

  it('마디 칸 수가 틀리면 알려 줌', () => {
    const bad: Song = { bpm: 120, steps: 8, vol: 1, melody: [{ wave: 'square', vol: 0.2, env: { a: 0, d: 0, s: 1, r: 0 }, bars: ['A4 . .'] }] };
    expect(() => renderSong(bad, 8000)).toThrow();
  });
});
