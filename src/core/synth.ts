// 효과음 합성기(Phaser 없음). 파일이 없을 때 쓰는 기본 소리를 파라미터(JSON)로 만든다.
// 8/16비트 칩튠 질감(PRD §11): 기본 파형 + 노이즈 + 비트 감쇄 + 1극 저역통과. 결과는 -1~1 샘플 배열.

export type Wave = 'sine' | 'square' | 'saw' | 'triangle' | 'noise';

export interface SynthLayer {
  wave: Wave;
  /** 시작 주파수(Hz). noise는 노이즈 갱신 빈도(낮을수록 거친 "칙칙") */
  freq: number;
  /** 끝 주파수(Hz, 지수 미끄러짐). 없으면 고정 */
  freqEnd?: number;
  attackMs?: number;
  holdMs?: number;
  releaseMs: number;
  /** 감쇠 곡선 지수(1 직선, 2 이상 빠르게 줄어듦) */
  curve?: number;
  /** 0~1 */
  volume?: number;
  /** 사각파 듀티 0~1 */
  duty?: number;
  /** 비트 깊이(예: 6이면 64단계). 없으면 감쇄 없음 */
  crush?: number;
  /** 1극 저역통과 차단 주파수(Hz) */
  lowpassHz?: number;
  /** 시작 지연(ms) */
  delayMs?: number;
}

export function layerLengthMs(l: SynthLayer): number {
  return (l.delayMs ?? 0) + (l.attackMs ?? 0) + (l.holdMs ?? 0) + l.releaseMs;
}

/** 여러 겹을 합성해 하나의 버퍼로. pitchMul로 전체 음높이를 바꿔 변형을 만든다. 최대 진폭은 peak로 맞춘다 */
export function synthesize(layers: readonly SynthLayer[], sampleRate: number, rand: () => number, pitchMul = 1, peak = 0.9): Float32Array<ArrayBuffer> {
  const totalMs = Math.max(1, ...layers.map(layerLengthMs));
  const n = Math.ceil((totalMs / 1000) * sampleRate);
  const out = new Float32Array(new ArrayBuffer(n * 4));
  for (const l of layers) renderLayer(out, l, sampleRate, rand, pitchMul);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(out[i] ?? 0));
  if (max > 0) {
    const g = peak / max;
    for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * g;
  }
  return out;
}

function renderLayer(out: Float32Array, l: SynthLayer, sr: number, rand: () => number, pitchMul: number): void {
  const a = ((l.attackMs ?? 0) / 1000) * sr;
  const h = ((l.holdMs ?? 0) / 1000) * sr;
  const r = (l.releaseMs / 1000) * sr;
  const start = Math.floor(((l.delayMs ?? 0) / 1000) * sr);
  const len = Math.ceil(a + h + r);
  const f0 = l.freq * pitchMul;
  const f1 = (l.freqEnd ?? l.freq) * pitchMul;
  const vol = l.volume ?? 1;
  const curve = l.curve ?? 1;
  const duty = l.duty ?? 0.5;
  const steps = l.crush ? 2 ** l.crush : 0;
  const lpA = l.lowpassHz ? 1 - Math.exp((-2 * Math.PI * l.lowpassHz) / sr) : 1;
  let phase = 0;
  let noiseVal = 0;
  let noisePhase = 1;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= out.length) break;
    const t = len > 1 ? i / (len - 1) : 0;
    const f = f0 * (f1 / f0) ** t;
    phase += f / sr;
    phase -= Math.floor(phase);
    let s: number;
    switch (l.wave) {
      case 'sine':
        s = Math.sin(phase * Math.PI * 2);
        break;
      case 'square':
        s = phase < duty ? 1 : -1;
        break;
      case 'saw':
        s = phase * 2 - 1;
        break;
      case 'triangle':
        s = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
        break;
      default: {
        noisePhase += f / sr;
        if (noisePhase >= 1) {
          noisePhase -= Math.floor(noisePhase);
          noiseVal = rand() * 2 - 1;
        }
        s = noiseVal;
      }
    }
    let env: number;
    if (i < a) env = i / Math.max(1, a);
    else if (i < a + h) env = 1;
    else env = Math.max(0, 1 - (i - a - h) / Math.max(1, r)) ** curve;
    s *= env * vol;
    if (steps) s = Math.round(s * steps) / steps;
    lp += (s - lp) * lpA;
    out[idx] = (out[idx] ?? 0) + lp;
  }
}
