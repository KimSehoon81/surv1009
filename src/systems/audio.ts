import type * as Phaser from 'phaser';
import sfxData from '../data/sfx.json';
import { synthesize, type SynthLayer } from '../core/synth';
import {
  CueGate,
  VoiceTable,
  aggregateGainDb,
  comboSemitones,
  dbToGain,
  distanceGain,
  duckDb,
  panFromX,
  semitonesToRate,
  stateTargets,
  type DuckSpec,
  type MixState,
  type StateRule,
} from '../core/audioMix';
import type { Rng } from '../core/rng';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { manifest } from '../assets/manifest';
import { loadProfile, updateProfile } from './save';

/** 소리를 내는 쪽이 아는 것은 이것뿐(feel 프리셋의 sfx, 총구, 보급품 등) */
export interface AudioSink {
  play(cue: string, x?: number, y?: number, opt?: { combo?: number }): void;
  /** 소리 길이(ms, 휘슬 끝 정렬용). 모르면 0 */
  durationMs?(cue: string): number;
}

export const NO_AUDIO: AudioSink = { play: () => undefined };

/** 볼륨 설정(저장: settings.volume). 버스 기본값에 곱하는 0~1 */
export interface VolumeSettings {
  master: number;
  bgm: number;
  sfx: number;
  ui: number;
}
export const DEFAULT_VOLUME: VolumeSettings = { master: 1, bgm: 1, sfx: 1, ui: 1 };

type BusName = 'bgm' | 'sfx' | 'ui' | 'amb';

interface CueData {
  src: string;
  bus: BusName;
  vol: number;
  pitchSt: number[];
  cooldownMs: number;
  maxVoices: number;
  priority: number;
  center?: boolean;
  combo?: { maxSt: number };
  duck?: DuckSpec;
  /** 재생 속도 곡선 [시작, 끝](도플러 근사) */
  rateRamp?: number[];
}

interface SourceData {
  variants?: number;
  vary?: number;
  layers: SynthLayer[];
}

const CUES = sfxData.cues as Record<string, CueData>;
const SOURCES = sfxData.sources as Record<string, SourceData>;
const STATES = sfxData.states as Partial<Record<keyof MixState, StateRule>>;
const LIMITS = sfxData.limits;
const BUS_NAMES: BusName[] = ['bgm', 'sfx', 'ui', 'amb'];

const BGM = sfxData.bgm as { fadeMs: number; tracks: Record<string, { vol: number; loopStart: number; loopEnd: number }> };
const SILENCE = sfxData.silence;

// 소리 버퍼는 게임 전체에서 한 번(씬 재시작마다 다시 만들지 않음). 파일이 있으면 파일, 없으면 합성
const bufferCache = new Map<string, AudioBuffer[]>();
/** 어느 소리가 파일에서 왔는지(갤러리·검증 표시) */
export const fromFile = new Set<string>();

/**
 * 효과음 재생과 믹싱(PRD §11). Phaser는 AudioContext와 첫 입력 잠금 해제만 맡고,
 * 버스·필터·리미터는 Phaser 사운드 매니저에 없으므로 WebAudio 노드를 직접 만든다.
 * source → gain → panner → 버스 gain → 버스 저역통과 → master → compressor → 출력.
 * WebAudio가 없으면(오디오 없는 환경) 아무것도 하지 않는다.
 */
export class AudioSystem implements AudioSink {
  /** 모노 출력(설정): 좌우 팬 없음 */
  mono = false;
  private readonly ctx: AudioContext | null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private readonly buses = new Map<BusName, { gain: GainNode; lpf: BiquadFilterNode; base: number }>();
  private readonly voices = new VoiceTable(LIMITS.voices);
  private readonly gate = new CueGate();
  private readonly live = new Map<number, { src: AudioBufferSourceNode; gain: GainNode; base: number }>();
  private readonly lastVoice = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private readonly ducks: { spec: DuckSpec; start: number }[] = [];
  private readonly warned = new Set<string>();
  private newPitchSt = 0;
  private volume: VolumeSettings = { ...DEFAULT_VOLUME, ...loadProfile().settings.volume };
  /** 이 시각(오디오 시계 ms)까지 효과음 버스 무음(큰 착탄 직전 0.2초) */
  private silenceUntil = 0;
  private bgm: { name: string; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** 잠금 해제(첫 입력) 전에 요청된 곡 */
  private pendingBgm: string | null = null;
  private camX = 0;
  private camY = 0;
  private frame = 0;
  /** 디버그·검증용 */
  played = 0;
  dropped = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly rng: Rng,
  ) {
    const ctx = (scene.sound as unknown as { context?: AudioContext }).context;
    this.ctx = ctx && typeof ctx.createGain === 'function' ? ctx : null;
    if (!this.ctx) return;
    this.buildGraph(this.ctx);
    this.ensureBuffers(this.ctx, rng.fork('synth'));
  }

  /** Preload가 load.audio로 받아 둔 파일 버퍼(없으면 null) */
  private fileBuffers(name: string): AudioBuffer[] | null {
    const files = manifest.audio(name);
    const cache = this.scene.cache.audio;
    const bufs = files.map((f) => (cache.exists(f.key) ? (cache.get(f.key) as unknown) : null)).filter((b): b is AudioBuffer => b instanceof AudioBuffer);
    return bufs.length > 0 ? bufs : null;
  }

  get enabled(): boolean {
    return this.ctx !== null;
  }

  get activeVoices(): number {
    return this.voices.size;
  }

  private buildGraph(ctx: AudioContext): void {
    const c = sfxData.compressor;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = c.thresholdDb;
    this.comp.knee.value = c.kneeDb;
    this.comp.ratio.value = c.ratio;
    this.comp.attack.value = c.attackMs / 1000;
    this.comp.release.value = c.releaseMs / 1000;
    this.master = ctx.createGain();
    this.master.gain.value = sfxData.buses.master * this.volume.master;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    for (const name of BUS_NAMES) {
      const gain = ctx.createGain();
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.value = 20000;
      const base = sfxData.buses[name];
      gain.gain.value = base;
      gain.connect(lpf);
      lpf.connect(this.master);
      this.buses.set(name, { gain, lpf, base });
    }
  }

  private ensureBuffers(ctx: AudioContext, synthRng: Rng): void {
    for (const [name, src] of Object.entries(SOURCES)) {
      if (bufferCache.has(name)) continue;
      const files = this.fileBuffers(name);
      if (files) {
        bufferCache.set(name, files);
        fromFile.add(name);
        continue;
      }
      const n = Math.max(1, src.variants ?? 1);
      const vary = src.vary ?? 0;
      const list: AudioBuffer[] = [];
      for (let i = 0; i < n; i++) {
        // 변형: 음높이를 -vary~+vary 사이로 고르게 나눔
        const mul = n === 1 ? 1 : 1 - vary + (2 * vary * i) / (n - 1);
        const data = synthesize(src.layers, ctx.sampleRate, () => synthRng.next(), mul);
        const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
        buf.copyToChannel(data, 0);
        list.push(buf);
      }
      bufferCache.set(name, list);
    }
  }

  private nowMs(): number {
    return (this.ctx?.currentTime ?? 0) * 1000;
  }

  play(cue: string, x?: number, y?: number, opt: { combo?: number } = {}): void {
    const ctx = this.ctx;
    // 첫 입력 전(잠김)이나 탭이 가려진 상태면 버린다. BGM은 D15에서 잠금 해제 후 시작
    if (!ctx || ctx.state !== 'running') return;
    const c = CUES[cue];
    if (!c) {
      if (!this.warned.has(cue)) {
        this.warned.add(cue);
        console.warn(`[audio] 알 수 없는 소리: ${cue}`);
      }
      return;
    }
    const bus = this.buses.get(c.bus);
    const buffers = bufferCache.get(c.src);
    if (!bus || !buffers || buffers.length === 0) return;
    const now = this.nowMs();

    let gainMul = 1;
    let pan = 0;
    if (x !== undefined && !c.center) {
      gainMul = distanceGain(x - this.camX, (y ?? this.camY) - this.camY, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, LIMITS.cullOutsideK);
      if (gainMul <= 0) {
        this.dropped++;
        return;
      }
      pan = this.mono ? 0 : panFromX(x, this.camX, LOGICAL_WIDTH / 2, LIMITS.panWidth);
    }

    const g = this.gate.check(cue, now, c.cooldownMs, this.frame);
    if (!g.ok) {
      // 같은 프레임에 같은 소리가 여러 번 오면 직전 재생의 음량만 올린다
      const lastId = this.lastVoice.get(cue);
      const v = lastId !== undefined ? this.live.get(lastId) : undefined;
      if (g.sameFrame && v) v.gain.gain.setTargetAtTime(v.base * dbToGain(aggregateGainDb(g.count)), ctx.currentTime, 0.005);
      this.dropped++;
      return;
    }

    const d = this.voices.decide(cue, c.priority, c.maxVoices, now);
    if (d.action === 'drop') {
      this.dropped++;
      return;
    }
    if (d.action === 'steal') this.stop(d.id);

    // 변형: 직전과 같은 것을 연달아 쓰지 않음
    let vi = Math.floor(this.rng.next() * buffers.length);
    if (buffers.length > 1 && vi === this.lastVariant.get(cue)) vi = (vi + 1) % buffers.length;
    this.lastVariant.set(cue, vi);
    const buffer = buffers[vi] as AudioBuffer;

    const lo = c.pitchSt[0] ?? 0;
    const hi = c.pitchSt[1] ?? lo;
    const st = lo + (hi - lo) * this.rng.next() + (c.combo && opt.combo ? comboSemitones(opt.combo, c.combo.maxSt) : 0) + this.newPitchSt;
    const rate = semitonesToRate(st);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    if (c.rateRamp && c.rateRamp.length >= 2) {
      // 도플러 근사: 다가올 때 높고 멀어질 때 낮게
      const t0 = ctx.currentTime;
      src.playbackRate.setValueAtTime(rate * (c.rateRamp[0] ?? 1), t0);
      src.playbackRate.linearRampToValueAtTime(rate * (c.rateRamp[1] ?? 1), t0 + buffer.duration);
    }
    const gain = ctx.createGain();
    const base = c.vol * gainMul;
    gain.gain.value = base;
    src.connect(gain);
    let tail: AudioNode = gain;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      gain.connect(p);
      tail = p;
    }
    tail.connect(bus.gain);
    const id = this.voices.add(cue, c.priority, now, (buffer.duration * 1000) / rate);
    this.live.set(id, { src, gain, base });
    this.lastVoice.set(cue, id);
    src.onended = () => {
      tail.disconnect();
      gain.disconnect();
      this.live.delete(id);
      this.voices.remove(id);
    };
    src.start();
    this.played++;
    if (c.duck) this.ducks.push({ spec: c.duck, start: now });
  }

  durationMs(cue: string): number {
    const c = CUES[cue];
    const b = c ? bufferCache.get(c.src)?.[0] : undefined;
    return b ? b.duration * 1000 : 0;
  }

  /** 효과음 버스를 ms 동안 내림(큰 착탄 직전 0.2초 무음, PRD §6.2) */
  silence(ms: number): void {
    this.silenceUntil = Math.max(this.silenceUntil, this.nowMs() + ms);
  }

  /** 곡 전환(교차 페이드). 파일이 없으면 지금 곡을 내리고 무음 */
  playBgm(name: string | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      this.pendingBgm = name;
      return;
    }
    this.pendingBgm = null;
    if (this.bgm?.name === name) return;
    const fade = BGM.fadeMs / 1000;
    const t = ctx.currentTime;
    const old = this.bgm;
    if (old) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(old.gain.gain.value, t);
      old.gain.gain.linearRampToValueAtTime(0, t + fade);
      old.src.stop(t + fade + 0.05);
    }
    this.bgm = null;
    const bus = this.buses.get('bgm');
    const track = name ? BGM.tracks[name] : undefined;
    const buf = name ? this.fileBuffers(name)?.[0] : undefined;
    if (!name || !bus || !track || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (track.loopEnd > track.loopStart) {
      src.loopStart = track.loopStart;
      src.loopEnd = track.loopEnd;
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(track.vol, t + fade);
    src.connect(gain).connect(bus.gain);
    src.start();
    this.bgm = { name, src, gain };
  }

  get bgmPlaying(): string | null {
    return this.bgm?.name ?? null;
  }

  get volumes(): VolumeSettings {
    return { ...this.volume };
  }

  /** 볼륨 설정(0~1) 바꾸고 저장 */
  setVolume(bus: keyof VolumeSettings, v: number): void {
    this.volume[bus] = Math.max(0, Math.min(1, v));
    const vol = { ...this.volume };
    updateProfile((d) => {
      d.settings.volume = vol;
    });
    if (bus === 'master' && this.master && this.ctx) this.master.gain.setTargetAtTime(sfxData.buses.master * this.volume.master, this.ctx.currentTime, 0.02);
  }

  private stop(id: number): void {
    const v = this.live.get(id);
    if (v) {
      try {
        v.src.stop();
      } catch {
        // 이미 끝난 소스
      }
    }
    this.live.delete(id);
    this.voices.remove(id);
  }

  /** 매 프레임: 시간 상태(일시정지·슬로모·판정)와 덕킹을 버스에 반영, 카메라 중심(팬·거리 기준) 갱신 */
  update(state: MixState, camCenterX: number, camCenterY: number): void {
    this.camX = camCenterX;
    this.camY = camCenterY;
    this.frame++;
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.pendingBgm !== null && ctx.state === 'running') this.playBgm(this.pendingBgm);
    const now = this.nowMs();
    const t = stateTargets(state, STATES);
    const silent = now < this.silenceUntil ? SILENCE.db : 0;
    let duck = 0;
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      const dk = this.ducks[i];
      if (!dk) continue;
      const el = now - dk.start;
      if (el >= dk.spec.attackMs + dk.spec.holdMs + dk.spec.releaseMs) {
        this.ducks.splice(i, 1);
        continue;
      }
      duck = Math.min(duck, duckDb(dk.spec, el));
    }
    const tc = LIMITS.rampMs / 1000 / 3;
    const set = (name: BusName, db: number, lpfHz: number) => {
      const b = this.buses.get(name);
      if (!b) return;
      const vol = name === 'amb' ? this.volume.sfx : this.volume[name];
      b.gain.gain.setTargetAtTime(b.base * vol * dbToGain(db), ctx.currentTime, name === 'sfx' && silent < 0 ? SILENCE.rampMs / 1000 / 3 : tc);
      b.lpf.frequency.setTargetAtTime(lpfHz, ctx.currentTime, tc);
    };
    set('bgm', t.bgmDb + duck, t.bgmLpfHz);
    set('sfx', t.sfxDb + silent, t.sfxLpfHz);
    set('ui', 0, 20000);
    set('amb', t.ambDb, 20000);
    this.newPitchSt = t.newPitchSt;
  }

  destroy(): void {
    try {
      this.bgm?.src.stop();
    } catch {
      // 이미 멈춤
    }
    this.bgm = null;
    for (const id of [...this.live.keys()]) this.stop(id);
    this.voices.clear();
    this.gate.clear();
    this.ducks.length = 0;
    this.master?.disconnect();
    this.comp?.disconnect();
    for (const b of this.buses.values()) {
      b.gain.disconnect();
      b.lpf.disconnect();
    }
    this.buses.clear();
  }
}
