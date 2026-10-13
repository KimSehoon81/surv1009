import type * as Phaser from 'phaser';
import timelinesData from '../data/timelines.json';
import cuesData from '../data/cues.json';
import combat from '../data/combat.json';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import type { Rng } from '../core/rng';
import type { SpatialHash } from '../core/spatialHash';
import { MARKER_CUE, TimelinePlayer, expandTimeline, type FiredEvent, type Point, type TimelineDef } from '../core/timeline';
import { Depth } from '../config/depth';
import { LOGICAL_HEIGHT } from '../config/display';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { PIXEL_FONT, ensurePixelFont } from '../ui/pixelFont';
import type { AudioSink } from './audio';
import type { GameClock } from './clock';
import type { EffectRunner } from './effectRunner';
import type { Feel } from './feel';
import type { FxSystem } from './fx';

type Layer = 'decal' | 'shadow' | 'explosion' | 'smoke' | 'air';

/** 연출 데이터 2층(cues.json) */
export interface CueDef {
  feel?: string;
  sfx?: string;
  fx?: string;
  fxFrom?: number;
  fxScale?: number;
  fxLayer?: Layer;
  fxAlpha?: number;
  fxDy?: number;
  fly?: { sprite: string; ms: number; scale: number; shadow?: boolean; alpha?: number; dx?: number; dy?: number; grow?: number };
  dropShadow?: { ms: number; from: number; to: number };
  prop?: { sheet: string; frames: readonly number[]; fps: number; fpsEnd?: number; ms: number; scale: number };
  countdown?: { from: number; sfx?: string };
  hook?: string;
}

export const TIMELINES = timelinesData.timelines as unknown as Record<string, TimelineDef>;
export const CUES = cuesData.cues as unknown as Record<string, CueDef>;
const AIM = timelinesData.aim;
/** 캐릭터를 덮는 층(연기·하늘)의 알파 상한(PRD §6.4 가독성) */
const OVERLAY_ALPHA_MAX = 0.7;

const LAYER_DEPTH: Record<Layer, number> = {
  decal: Depth.Decal,
  shadow: Depth.Shadow,
  explosion: Depth.Explosion,
  smoke: Depth.Smoke,
  air: Depth.Air,
};

/** 반투명 규칙을 강제하는 유일한 곳: 층 깊이 + 알파(연기·하늘은 0.7 상한) */
function applyLayer(s: Phaser.GameObjects.Sprite, layer: Layer, alpha = 1): Phaser.GameObjects.Sprite {
  const a = layer === 'smoke' || layer === 'air' ? Math.min(alpha, OVERLAY_ALPHA_MAX) : alpha;
  return s.setDepth(LAYER_DEPTH[layer]).setAlpha(a);
}

export interface TimelineDeps {
  scene: Phaser.Scene;
  clock: GameClock;
  fx: FxSystem;
  feel: Feel;
  audio: AudioSink;
  effects: EffectRunner;
  grid: SpatialHash<Enemy>;
  player: Player;
  rng: Rng;
  /** 범위 피해만(연출은 큐가 낸다). 맞은 적마다 aoe_hit */
  damage(x: number, y: number, radius: number, mult: number): void;
}

interface Run {
  player: TimelinePlayer;
  power: number;
}

interface Flyer {
  sprite: Phaser.GameObjects.Sprite;
  scale: number;
  grow: number;
  x: number;
  dy: number;
  startMs: number;
  ms: number;
  margin: number;
}

interface Prop {
  sprite: Phaser.GameObjects.Sprite;
  startMs: number;
  ms: number;
  first: number;
  span: number;
  fps: number;
  fpsEnd: number;
  phase: number;
  lastMs: number;
}

interface Countdown {
  text: Phaser.GameObjects.BitmapText;
  startMs: number;
  from: number;
  shown: number;
  sfx: string | undefined;
  x: number;
  y: number;
}

interface DropShadow {
  x: number;
  y: number;
  startMs: number;
  ms: number;
  from: number;
  to: number;
}

/**
 * 연출 타임라인 실행기(조합 스킬·고급 스킬 공용). 전투 시계 기준으로 이벤트를 꺼내 큐를 실행한다.
 * 착탄 프레임 0: 피해 → 타격감 프리셋(섬광·소리·킥·링) → 시트. 소리는 미리 예약하지 않고 이벤트가 올 때 낸다.
 */
export class TimelineSystem {
  private runs: Run[] = [];
  private flyers: Flyer[] = [];
  private props: Prop[] = [];
  private countdowns: Countdown[] = [];
  private shadows: DropShadow[] = [];
  private readonly sprites: Pool<Phaser.GameObjects.Sprite>;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private lastMouseMove = -Infinity;

  constructor(private readonly d: TimelineDeps) {
    const scene = d.scene;
    this.sprites = new Pool(() => scene.add.sprite(0, 0, '__DEFAULT').setActive(false).setVisible(false), 8);
    this.gfx = scene.add.graphics().setDepth(Depth.Shadow);
    ensurePixelFont(scene);
    scene.input.on('pointermove', () => {
      this.lastMouseMove = scene.time.now;
    });
  }

  has(id: string): boolean {
    return id in TIMELINES;
  }

  get active(): number {
    return this.runs.length;
  }

  /**
   * 조준점: 마우스를 최근에 움직였으면 커서(손패 영역 제외, 편의 옵션), 아니면 화면 안 적이 가장 많은 칸 중심,
   * 적이 없으면 바라보는 쪽 앞.
   */
  aimPoint(): Point {
    const scene = this.d.scene;
    const cam = scene.cameras.main;
    const ptr = scene.input.activePointer;
    if (AIM.mouse && scene.time.now - this.lastMouseMove <= AIM.mouseRecentMs && ptr.y < LOGICAL_HEIGHT - AIM.ignoreBottomPx) {
      const w = cam.getWorldPoint(ptr.x, ptr.y);
      return { x: w.x, y: w.y };
    }
    const v = cam.worldView;
    const p = this.d.player;
    return this.d.grid.densestCell(v.x, v.y, v.right, v.bottom, (e) => e.alive) ?? { x: p.x + p.facing * 120, y: p.y };
  }

  /** 타임라인 시작. power는 피해 배수(조합 위력 능력치) */
  play(id: string, power = 1, aim: Point = this.aimPoint()): boolean {
    const def = TIMELINES[id];
    if (!def) return false;
    const p = this.d.player;
    const events = expandTimeline(def, { aim, player: { x: p.x, y: p.y }, minFanDist: AIM.minFanDist }, () => this.d.rng.next());
    const run = { player: new TimelinePlayer(events, this.d.clock.timeMs), power };
    this.runs.push(run);
    this.fireDue(run, this.d.clock.timeMs);
    return true;
  }

  private fireDue(run: Run, now: number): void {
    for (const ev of run.player.due(now)) this.fire(ev, run.power);
  }

  private fire(ev: FiredEvent, power: number): void {
    const d = this.d;
    if (ev.cue === MARKER_CUE) {
      d.effects.marker(ev, ev.radius || 40, ev.durationMs);
      return;
    }
    const c = CUES[ev.cue];
    if (!c) return;
    if (ev.damage > 0) d.damage(ev.x, ev.y, ev.radius, ev.damage * power);
    if (c.feel) d.feel.hit(c.feel, ev.x, ev.y - combat.bodyOffsetY * 0.4, { groundY: ev.y });
    if (c.fx) {
      const layer = c.fxLayer ?? 'explosion';
      const s = d.fx.playFrom(c.fx, c.fxFrom ?? 0, ev.x, ev.y - (c.fxDy ?? 0), c.fxScale ?? 1, LAYER_DEPTH[layer]);
      if (s) applyLayer(s, layer, c.fxAlpha ?? 1);
    }
    if (c.sfx) d.audio.play(c.sfx, ev.x, ev.y);
    const now = d.clock.timeMs;
    if (c.fly) this.spawnFlyer(ev, c.fly, now);
    if (c.dropShadow) this.shadows.push({ x: ev.x, y: ev.y, startMs: now, ...c.dropShadow });
    if (c.prop) this.spawnProp(ev, c.prop, now);
    if (c.countdown) this.spawnCountdown(ev, c.countdown, now);
    if (c.hook) d.scene.events.emit('timeline:hook', c.hook, ev);
  }

  private spawnFlyer(ev: FiredEvent, f: NonNullable<CueDef['fly']>, now: number): void {
    const spec = manifest.fx(f.sprite);
    const s = this.sprites.acquire();
    s.setTexture(spec.key, 0).setScale(f.scale).setOrigin(0.5).setFlipY(true).setActive(true).setVisible(true);
    if (f.shadow) {
      s.setTintFill(0x000000);
      applyLayer(s, 'shadow', f.alpha ?? 0.35);
    } else {
      s.clearTint();
      applyLayer(s, 'air', f.alpha ?? 1);
    }
    this.flyers.push({ sprite: s, scale: f.scale, grow: f.grow ?? 0, x: ev.x + (f.dx ?? 0), dy: f.dy ?? 0, startMs: now, ms: f.ms, margin: (spec.frameSize * f.scale) / 2 });
  }

  private spawnProp(ev: FiredEvent, p: NonNullable<CueDef['prop']>, now: number): void {
    const spec = manifest.fx(p.sheet);
    const [first = 0, last = first] = p.frames;
    const s = this.sprites.acquire();
    s.setTexture(spec.key, first).setScale(p.scale).setOrigin(0.5, 0.85).setFlipY(false).clearTint().setActive(true).setVisible(true);
    s.setPosition(ev.x, ev.y);
    s.setDepth(Depth.Unit).setAlpha(1);
    this.props.push({ sprite: s, startMs: now, ms: p.ms, first, span: last - first + 1, fps: p.fps, fpsEnd: p.fpsEnd ?? p.fps, phase: 0, lastMs: now });
  }

  private spawnCountdown(ev: FiredEvent, c: NonNullable<CueDef['countdown']>, now: number): void {
    const text = this.d.scene.add.bitmapText(ev.x, ev.y - 44, PIXEL_FONT, '', 7).setOrigin(0.5).setLetterSpacing(-1).setDepth(Depth.DamageText);
    this.countdowns.push({ text, startMs: now, from: c.from, shown: 0, sfx: c.sfx, x: ev.x, y: ev.y - 44 });
  }

  /** 매 프레임(전투 시계). 타임라인 진행 + 비행체·설치물·카운트·낙하 그림자 */
  update(): void {
    const now = this.d.clock.timeMs;
    for (const r of this.runs) this.fireDue(r, now);
    this.runs = this.runs.filter((r) => !r.player.done);

    const view = this.d.scene.cameras.main.worldView;
    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i] as Flyer;
      const k = (now - f.startMs) / f.ms;
      if (k >= 1) {
        this.release(f.sprite);
        this.flyers.splice(i, 1);
        continue;
      }
      // 화면 위 바깥 → 아래 바깥(카메라를 따라가며)
      f.sprite.setPosition(f.x, view.y - f.margin + k * (view.height + f.margin * 2) + f.dy);
      // 그림자는 지나가며 조금씩 커진다(고도가 낮아지는 느낌)
      if (f.grow) f.sprite.setScale(f.scale * (1 + f.grow * k));
    }

    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i] as Prop;
      const k = (now - p.startMs) / p.ms;
      if (k >= 1) {
        this.release(p.sprite);
        this.props.splice(i, 1);
        continue;
      }
      // 점멸 가속: 재생 속도를 fps → fpsEnd로 올리며 프레임 위상을 적분
      const fps = p.fps + (p.fpsEnd - p.fps) * k;
      p.phase += ((now - p.lastMs) / 1000) * fps;
      p.lastMs = now;
      p.sprite.setFrame(p.first + (Math.floor(p.phase) % p.span));
    }

    for (let i = this.countdowns.length - 1; i >= 0; i--) {
      const c = this.countdowns[i] as Countdown;
      const sec = Math.floor((now - c.startMs) / 1000);
      const n = c.from - sec;
      if (n <= 0) {
        c.text.destroy();
        this.countdowns.splice(i, 1);
        continue;
      }
      if (n !== c.shown) {
        c.shown = n;
        c.text.setText(String(n)).setTint(n === 1 ? 0xff5040 : 0xffffff);
        // 삑 소리 음높이 상승(3 → 2 → 1)
        if (c.sfx) this.d.audio.play(c.sfx, c.x, c.y, { combo: c.from - n + 1 });
      }
      const pop = Math.min(1, ((now - c.startMs) % 1000) / 150);
      c.text.setScale(3 * (1.3 - 0.3 * pop));
    }

    const g = this.gfx.clear();
    this.shadows = this.shadows.filter((s) => now - s.startMs < s.ms);
    for (const s of this.shadows) {
      const k = (now - s.startMs) / s.ms;
      const r = s.from + (s.to - s.from) * k;
      g.fillStyle(0x000000, 0.25 + 0.2 * k).fillEllipse(s.x, s.y, r * 2, r);
    }
  }

  private release(s: Phaser.GameObjects.Sprite): void {
    s.setActive(false).setVisible(false).clearTint().setFlipY(false);
    this.sprites.release(s);
  }
}
