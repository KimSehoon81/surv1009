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
      let bad = 0;
      for (const v of a) {
        if (!Number.isFinite(v)) bad++;
        peak = Math.max(peak, Math.abs(v));
        energy += v * v;
      }
      expect(bad, name).toBe(0);
      expect(peak, name).toBeLessThanOrEqual(1);
      expect(energy / a.length, name).toBeGreaterThan(0.005);
      // 같은 시드면 같은 결과(바이트 비교: 큰 배열의 깊은 비교는 느림)
      const again = renderSong(song, sr, 7);
      expect(Buffer.from(again.buffer).equals(Buffer.from(a.buffer)), name).toBe(true);
    }
  });

  it('마디 칸 수가 틀리면 알려 줌', () => {
    const bad: Song = { bpm: 120, steps: 8, vol: 1, melody: [{ wave: 'square', vol: 0.2, env: { a: 0, d: 0, s: 1, r: 0 }, bars: ['A4 . .'] }] };
    expect(() => renderSong(bad, 8000)).toThrow();
  });
});

describe('지역별 전투 음악(2026-11-18)', () => {
  it('10개 지역이 각자 다른 곡을 쓰고, 곡마다 빠르기·선율이 다름', async () => {
    const stages = (await import('../src/data/stages.json')).default.stages as Record<string, { bgm?: string }>;
    const names = Object.values(stages).map((s) => s.bgm);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(SONGS[n ?? ''], n).toBeDefined();
    const leads = names.map((n) => SONGS[n ?? '']?.melody[0]?.bars.join('|'));
    expect(new Set(leads).size).toBe(leads.length);
  });

  it('지역 곡: 16마디, 끝마디 첫 음은 으뜸음(되풀이 이음매)', () => {
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pc = (tok: string) => NAMES.indexOf(tok.slice(0, -1));
    for (const [name, song] of Object.entries(SONGS)) {
      if (!/^bgm_stage(0[2-9]|10)$/.test(name)) continue;
      const lead = song.melody[0]?.bars ?? [];
      expect(lead.length, name).toBe(16);
      const bass = song.melody[2]?.bars ?? [];
      // 마지막 마디 선율 첫 음 = 첫 마디 베이스의 으뜸음과 같은 음이름
      expect(pc(lead[15]?.split(' ')[0] ?? ''), name).toBe(pc(bass[0]?.split(' ')[0] ?? ''));
    }
  });
});
