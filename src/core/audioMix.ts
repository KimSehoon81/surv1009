// 소리 믹싱 규칙(Phaser·WebAudio 없음, 테스트 대상). systems/audio.ts가 이 결정을 실제 노드에 적용한다.

/** 반음 → 재생 속도 배율 */
export function semitonesToRate(st: number): number {
  return 2 ** (st / 12);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

const PENTATONIC = [0, 2, 4, 7, 9];

/** 콤보 n번째 처치음의 반음 오프셋: 5음 음계로 한 칸씩, maxSt에서 멈춤(반음씩 올리면 불협화음) */
export function comboSemitones(n: number, maxSt: number): number {
  if (n <= 1) return 0;
  const i = n - 1;
  const st = Math.floor(i / PENTATONIC.length) * 12 + (PENTATONIC[i % PENTATONIC.length] ?? 0);
  return Math.min(st, maxSt);
}

/** 화면 x 위치 → 좌우 팬(-width~width) */
export function panFromX(x: number, camCenterX: number, halfViewW: number, width: number): number {
  if (halfViewW <= 0) return 0;
  return Math.max(-1, Math.min(1, (x - camCenterX) / halfViewW)) * width;
}

/** 화면 밖 거리 감쇠: 화면 안 1, 화면 크기의 cullK배 밖이면 0(재생 안 함), 그 사이 선형 */
export function distanceGain(dx: number, dy: number, halfW: number, halfH: number, cullK: number): number {
  const nx = Math.abs(dx) / halfW;
  const ny = Math.abs(dy) / halfH;
  const n = Math.max(nx, ny);
  if (n <= 1) return 1;
  if (n >= cullK) return 0;
  return 1 - (n - 1) / (cullK - 1);
}

/** 같은 프레임에 같은 소리가 n번 오면 1번만 내고 음량을 올린다: +min(6dB, 3·log2 n) */
export function aggregateGainDb(n: number): number {
  return n <= 1 ? 0 : Math.min(6, 3 * Math.log2(n));
}

export interface Voice {
  id: number;
  cue: string;
  priority: number;
  startMs: number;
  endMs: number;
}

export type VoiceDecision = { action: 'play' } | { action: 'steal'; id: number } | { action: 'drop' };

/**
 * 동시 재생 관리: 소리별 상한(maxVoices)과 전체 상한. 넘치면 같은 소리 중 가장 오래된 것을,
 * 전체가 넘치면 우선순위가 가장 낮고 오래된 것을 끊는다. 새 소리보다 우선순위가 높은 것만 남았으면 버린다.
 */
export class VoiceTable {
  private readonly voices: Voice[] = [];
  private nextId = 1;

  constructor(private readonly maxTotal: number) {}

  private prune(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) if ((this.voices[i]?.endMs ?? 0) <= now) this.voices.splice(i, 1);
  }

  decide(cue: string, priority: number, maxVoices: number, now: number): VoiceDecision {
    this.prune(now);
    const same = this.voices.filter((v) => v.cue === cue);
    if (same.length >= maxVoices) {
      const oldest = same.reduce((a, b) => (b.startMs < a.startMs ? b : a));
      return { action: 'steal', id: oldest.id };
    }
    if (this.voices.length < this.maxTotal) return { action: 'play' };
    let victim: Voice | undefined;
    for (const v of this.voices) {
      if (v.priority > priority) continue;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.startMs < victim.startMs)) victim = v;
    }
    return victim ? { action: 'steal', id: victim.id } : { action: 'drop' };
  }

  add(cue: string, priority: number, now: number, durationMs: number): number {
    const id = this.nextId++;
    this.voices.push({ id, cue, priority, startMs: now, endMs: now + durationMs });
    return id;
  }

  remove(id: number): void {
    const i = this.voices.findIndex((v) => v.id === id);
    if (i >= 0) this.voices.splice(i, 1);
  }

  get size(): number {
    return this.voices.length;
  }

  clear(): void {
    this.voices.length = 0;
  }
}

/** 소리별 재생 간격. 간격 안의 요청은 막고, 같은 프레임 요청 수를 센다(음량 합치기용) */
export class CueGate {
  private readonly last = new Map<string, { at: number; frame: number; count: number }>();

  /** 재생해도 되면 ok. 막혔을 때 sameFrame이면 직전 재생에 합쳐 음량을 올릴 수 있다(count = 이번 프레임 요청 수) */
  check(cue: string, now: number, cooldownMs: number, frame: number): { ok: boolean; sameFrame: boolean; count: number } {
    const prev = this.last.get(cue);
    if (prev && now - prev.at < cooldownMs) {
      const sameFrame = frame === prev.frame;
      if (sameFrame) prev.count++;
      return { ok: false, sameFrame, count: prev.count };
    }
    this.last.set(cue, { at: now, frame, count: 1 });
    return { ok: true, sameFrame: false, count: 1 };
  }

  clear(): void {
    this.last.clear();
  }
}

export interface DuckSpec {
  db: number;
  attackMs: number;
  holdMs: number;
  releaseMs: number;
}

/** 덕킹 하나의 현재 감쇠(dB, 0 이하). 여러 덕킹이 겹치면 가장 깊은 값을 쓴다 */
export function duckDb(spec: DuckSpec, elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < spec.attackMs) return spec.db * (elapsedMs / spec.attackMs);
  const t = elapsedMs - spec.attackMs;
  if (t < spec.holdMs) return spec.db;
  const r = t - spec.holdMs;
  if (r >= spec.releaseMs) return 0;
  return spec.db * (1 - r / spec.releaseMs);
}

export interface MixState {
  paused: boolean;
  slowmo: boolean;
  judge: boolean;
}

export interface StateRule {
  bgmDb?: number;
  sfxDb?: number;
  ambDb?: number;
  bgmLpfHz?: number;
  sfxLpfHz?: number;
  /** 새로 나는 효과음 음높이(반음) */
  newPitchSt?: number;
}

export interface BusTargets {
  bgmDb: number;
  sfxDb: number;
  ambDb: number;
  bgmLpfHz: number;
  sfxLpfHz: number;
  newPitchSt: number;
}

const OPEN_HZ = 20000;

/** 시간 상태(일시정지·슬로모·판정) → 버스 목표값. 여러 상태가 겹치면 더 깊은 쪽 */
export function stateTargets(state: MixState, rules: Partial<Record<keyof MixState, StateRule>>): BusTargets {
  const t: BusTargets = { bgmDb: 0, sfxDb: 0, ambDb: 0, bgmLpfHz: OPEN_HZ, sfxLpfHz: OPEN_HZ, newPitchSt: 0 };
  for (const key of ['paused', 'slowmo', 'judge'] as const) {
    if (!state[key]) continue;
    const r = rules[key];
    if (!r) continue;
    t.bgmDb = Math.min(t.bgmDb, r.bgmDb ?? 0);
    t.sfxDb = Math.min(t.sfxDb, r.sfxDb ?? 0);
    t.ambDb = Math.min(t.ambDb, r.ambDb ?? 0);
    t.bgmLpfHz = Math.min(t.bgmLpfHz, r.bgmLpfHz ?? OPEN_HZ);
    t.sfxLpfHz = Math.min(t.sfxLpfHz, r.sfxLpfHz ?? OPEN_HZ);
    t.newPitchSt = Math.min(t.newPitchSt, r.newPitchSt ?? 0);
  }
  return t;
}
