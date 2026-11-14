// 칩튠 렌더러(2026-11-14): 악보 데이터(data/music.json) → 모노 샘플. 사각파 멜로디·삼각파 베이스·노이즈 드럼.
// 군악풍 행진 리듬의 레트로 전투 음악을 파일 없이 만든다. Phaser·Web Audio 없음(테스트 대상)

export type Wave = 'square' | 'triangle' | 'noise' | 'saw';

export interface Envelope {
  a: number;
  d: number;
  s: number;
  r: number;
}

export interface MelodyTrack {
  wave: Wave;
  /** 사각파 듀티(0~1) */
  duty?: number;
  vol: number;
  env: Envelope;
  /** 음 길이 중 소리 나는 비율(행진곡은 끊어 침) */
  gate?: number;
  /** 비브라토 [반음 폭, Hz, 시작 지연 초] */
  vibrato?: [number, number, number];
  /** 마디를 공백으로 나눈 토큰: 음이름+옥타브(A4, C#5), '.'는 앞 음 이어서, '-'는 쉼 */
  bars: string[];
}

export interface DrumTrack {
  vol: number;
  /** 마디마다 토큰: K 큰북, S 작은북, H 하이햇, R 작은북 롤(반 칸씩 두 번), '.' 없음. 'K+H'처럼 겹침 */
  bars: string[];
}

export interface Song {
  bpm: number;
  /** 한 마디 칸 수(8이면 8분음표) */
  steps: number;
  vol: number;
  melody: MelodyTrack[];
  drums?: DrumTrack;
}

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** 'A4' → 440Hz. 음이 아니면 null */
export function noteFreq(tok: string): number | null {
  const m = /^([A-G]#?)(-?\d)$/.exec(tok);
  if (!m) return null;
  const midi = 12 * (Number(m[2]) + 1) + (NOTE[m[1] ?? 'A'] ?? 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

export const stepSec = (song: Song): number => 60 / song.bpm / (song.steps / 4);

export function songSteps(song: Song): number {
  const bars = Math.max(song.drums?.bars.length ?? 0, ...song.melody.map((t) => t.bars.length));
  return bars * song.steps;
}

const tokens = (bars: readonly string[], steps: number): string[] =>
  bars.flatMap((b) => {
    const tk = b.trim().split(/\s+/);
    if (tk.length !== steps) throw new Error(`bar needs ${steps} steps: "${b}"`);
    return tk;
  });

/** 결정적 잡음(LCG) */
function noiseGen(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

function envAt(e: Envelope, t: number, dur: number): number {
  if (t < 0) return 0;
  if (t < e.a) return t / Math.max(1e-6, e.a);
  if (t < dur) {
    const td = t - e.a;
    return td < e.d ? 1 - (1 - e.s) * (td / Math.max(1e-6, e.d)) : e.s;
  }
  const level = dur < e.a ? dur / Math.max(1e-6, e.a) : dur - e.a < e.d ? 1 - (1 - e.s) * ((dur - e.a) / Math.max(1e-6, e.d)) : e.s;
  const tr = t - dur;
  return tr < e.r ? level * (1 - tr / Math.max(1e-6, e.r)) : 0;
}

/** 곡 전체를 한 바퀴 렌더. 끝을 넘는 꼬리는 앞에 더해 반복 이음매가 매끄럽게 */
export function renderSong(song: Song, sampleRate: number, seed = 1): Float32Array {
  const step = stepSec(song);
  const total = songSteps(song);
  const n = Math.round(total * step * sampleRate);
  const out = new Float32Array(n);
  const add = (i: number, v: number) => {
    const k = ((i % n) + n) % n;
    out[k] = (out[k] ?? 0) + v;
  };
  const rnd = noiseGen(seed);
  for (const tr of song.melody) {
    const tk = tokens(tr.bars, song.steps);
    const len = tk.length;
    for (let i = 0; i < len; i++) {
      const f = noteFreq(tk[i] ?? '');
      if (f === null) continue;
      let l = 1;
      while (i + l < len && tk[i + l] === '.') l++;
      const dur = l * step * (tr.gate ?? 0.9);
      const start = Math.round(i * step * sampleRate);
      const samples = Math.round((dur + tr.env.r) * sampleRate);
      let phase = 0;
      let held = 0;
      for (let s = 0; s < samples; s++) {
        const t = s / sampleRate;
        const vib = tr.vibrato && t > tr.vibrato[2] ? 2 ** ((tr.vibrato[0] * Math.sin(2 * Math.PI * tr.vibrato[1] * t)) / 12) : 1;
        phase = (phase + (f * vib) / sampleRate) % 1;
        let w: number;
        if (tr.wave === 'square') w = phase < (tr.duty ?? 0.5) ? 1 : -1;
        else if (tr.wave === 'triangle') w = 4 * Math.abs(phase - 0.5) - 1;
        else if (tr.wave === 'saw') w = 2 * phase - 1;
        else {
          // 8비트 잡음: 음 높이마다 값을 잠깐 붙잡음
          if (s % Math.max(1, Math.round(sampleRate / (f * 8))) === 0) held = rnd();
          w = held;
        }
        add(start + s, w * envAt(tr.env, t, dur) * tr.vol);
      }
    }
  }
  if (song.drums) renderDrums(song, song.drums, sampleRate, step, add, rnd);
  // 전체 음량과 부드러운 한계(넘치지 않게)
  for (let i = 0; i < n; i++) out[i] = Math.tanh((out[i] ?? 0) * song.vol);
  return out;
}

function renderDrums(song: Song, tr: DrumTrack, sr: number, step: number, add: (i: number, v: number) => void, rnd: () => number): void {
  const tk = tokens(tr.bars, song.steps);
  const hit = (kind: string, at: number, vol: number) => {
    const start = Math.round(at * sr);
    if (kind === 'K') {
      const len = Math.round(0.16 * sr);
      let ph = 0;
      for (let s = 0; s < len; s++) {
        const t = s / sr;
        ph += (45 + 120 * Math.exp(-t * 28)) / sr;
        add(start + s, Math.sin(2 * Math.PI * ph) * Math.exp(-t * 18) * vol * 1.1);
      }
    } else if (kind === 'S') {
      const len = Math.round(0.14 * sr);
      let prev = 0;
      for (let s = 0; s < len; s++) {
        const t = s / sr;
        const nz = rnd();
        const hp = nz - prev;
        prev = nz;
        add(start + s, (hp * 0.5 + Math.sin(2 * Math.PI * 185 * t) * 0.35 * Math.exp(-t * 40)) * Math.exp(-t * 22) * vol);
      }
    } else if (kind === 'H') {
      const len = Math.round(0.035 * sr);
      let prev = 0;
      for (let s = 0; s < len; s++) {
        const nz = rnd();
        add(start + s, (nz - prev) * 0.35 * Math.exp((-s / sr) * 90) * vol);
        prev = nz;
      }
    }
  };
  tk.forEach((tok, i) => {
    if (tok === '.' || tok === '-') return;
    for (const k of tok.split('+')) {
      if (k === 'R') {
        hit('S', i * step, tr.vol * 0.7);
        hit('S', (i + 0.5) * step, tr.vol * 0.85);
      } else hit(k, i * step, tr.vol);
    }
  });
}
