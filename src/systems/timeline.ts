import type * as Phaser from 'phaser';
import timelinesData from '../data/timelines.json';
import cuesData from '../data/cues.json';
import combat from '../data/combat.json';
import { manifest } from '../assets/manifest';
import { parseColor, startKnockback } from '../core/feel';
import { Pool } from '../core/pool';
import type { Rng } from '../core/rng';
import type { SpatialHash } from '../core/spatialHash';
import { MARKER_CUE, TimelinePlayer, expandTimeline, type FiredEvent, type Point, type TimelineDef } from '../core/timeline';
import { Depth } from '../config/depth';
import { LOGICAL_HEIGHT } from '../config/display';
import { MAX_ENEMY_RADIUS, type Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { PIXEL_FONT, ensurePixelFont } from '../ui/pixelFont';
import type { AudioSink } from './audio';
import type { GameClock } from './clock';
import type { EffectRunner } from './effectRunner';
import type { Feel } from './feel';
import type { FxSystem } from './fx';
import type { MineSystem } from './mines';

type Layer = 'decal' | 'shadow' | 'explosion' | 'smoke' | 'air';

/**
 * 연출 데이터 2층(cues.json). 필드 하나가 원자 동작 하나(handler)다.
 * 피해를 실어 나르는 원자(bullets·gunner·dash·mine·screenStrike)가 있으면 이벤트 damage를 그쪽에 넘기고,
 * 없으면 이벤트 위치에 범위 피해(radius)로 쓴다.
 */
export interface CueDef {
  feel?: string;
  sfx?: string;
  fx?: string;
  fxFrom?: number;
  fxScale?: number;
  fxLayer?: Layer;
  fxAlpha?: number;
  fxDy?: number;
  fly?: { sprite: string; frame?: number; dir?: 'down' | 'left' | 'right'; ms: number; scale: number; shadow?: boolean; alpha?: number; dx?: number; dy?: number; grow?: number };
  dropShadow?: { ms: number; from: number; to: number };
  prop?: { sheet: string; frames: readonly number[]; fps: number; fpsEnd?: number; ms: number; scale: number };
  countdown?: { from: number; sfx?: string };
  hook?: string;
  bullets?: { count: number; spreadDeg: number; rangePx: number; muzzle?: boolean };
  gunner?: { screen: readonly number[]; slide: readonly number[]; face: number; inMs: number; fireMs: number; outMs: number; intervalMs: number; rangePx: number; scale: number };
  arc?: { side: 'left' | 'right'; height: number };
  edgeFlash?: { side: 'left' | 'right'; ms: number; color: string; width: number };
  dash?: {
    sprite: string;
    frames?: readonly number[];
    fps: number;
    scale: number;
    speed: number;
    margin: number;
    width: number;
    knockback: number;
    hit: boolean;
    layer?: 'ground' | 'air';
    dir?: readonly number[];
    orient?: 'side' | 'top';
    tickMs?: number;
    reach?: number;
    trailCue?: string;
    trailEveryPx?: number;
  };
  fall?: { sheet: string; frames: readonly number[]; fps: number; height: number; scale: number };
  mine?: { armMs: number; lifeMs: number; triggerRadius: number; radius: number; scale: number };
  heal?: number;
  shield?: { ms: number; color: string };
  screenStrike?: boolean;
}

const CARRIERS = ['bullets', 'gunner', 'dash', 'mine', 'screenStrike'] as const;

export const TIMELINES = timelinesData.timelines as unknown as Record<string, TimelineDef>;
export const CUES = cuesData.cues as unknown as Record<string, CueDef>;
const AIM = timelinesData.aim;
const COUNTRIES = cuesData.countries.map((c) => parseColor(c));
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
  mines: MineSystem;
  grid: SpatialHash<Enemy>;
  player: Player;
  rng: Rng;
  /** 범위 피해만(연출은 큐가 낸다). 맞은 적마다 aoe_hit */
  damage(x: number, y: number, radius: number, mult: number): void;
  damageEnemy(e: Enemy, mult: number, dirX: number, dirY: number): void;
  /** 화면 안 살아 있는 적 */
  enemiesOnScreen(): Enemy[];
}

interface Run {
  player: TimelinePlayer;
  power: number;
}

/** 시간에 따라 움직이는 연출 물체. update가 false면 끝(destroy 호출) */
interface Actor {
  update(now: number): boolean;
  destroy(): void;
}

/**
 * 연출 타임라인 실행기(조합 스킬·고급 스킬 공용). 전투 시계 기준으로 이벤트를 꺼내 큐를 실행한다.
 * 착탄 프레임 0: 피해 → 타격감 프리셋(섬광·소리·킥·링) → 시트. 소리는 미리 예약하지 않고 이벤트가 올 때 낸다.
 * 화면 고정 물체(지원군 사수·가장자리 섬광)는 scrollFactor 0 층, 탄환·피해는 월드 좌표.
 */
export class TimelineSystem {
  private runs: Run[] = [];
  private actors: Actor[] = [];
  private readonly sprites: Pool<Phaser.GameObjects.Sprite>;
  /** 바닥(낙하 그림자·보호막 오라) / 공중(포탄) / 화면 고정(가장자리 섬광·국기 띠) */
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly air: Phaser.GameObjects.Graphics;
  private readonly screen: Phaser.GameObjects.Graphics;
  private lastMouseMove = -Infinity;

  constructor(private readonly d: TimelineDeps) {
    const scene = d.scene;
    this.sprites = new Pool(() => scene.add.sprite(0, 0, '__DEFAULT').setActive(false).setVisible(false), 8);
    this.ground = scene.add.graphics().setDepth(Depth.Shadow);
    this.air = scene.add.graphics().setDepth(Depth.Projectile);
    this.screen = scene.add.graphics().setDepth(Depth.ScreenFx).setScrollFactor(0);
    ensurePixelFont(scene);
    scene.input.on('pointermove', () => {
      this.lastMouseMove = scene.time.now;
    });
  }

  has(id: string): boolean {
    return id in TIMELINES;
  }

  get active(): number {
    return this.runs.length + this.actors.length;
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

  /** 타임라인 시작. power는 피해·회복 배수(조합 위력 능력치) */
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
    const now = d.clock.timeMs;
    const dmg = ev.damage * power;
    if (dmg > 0 && !CARRIERS.some((k) => c[k] !== undefined)) d.damage(ev.x, ev.y, ev.radius, dmg);
    if (c.feel) d.feel.hit(c.feel, ev.x, ev.y - combat.bodyOffsetY * 0.4, { groundY: ev.y });
    if (c.fx) {
      const layer = c.fxLayer ?? 'explosion';
      const s = d.fx.playFrom(c.fx, c.fxFrom ?? 0, ev.x, ev.y - (c.fxDy ?? 0), c.fxScale ?? 1, LAYER_DEPTH[layer]);
      if (s) applyLayer(s, layer, c.fxAlpha ?? 1);
    }
    if (c.sfx) d.audio.play(c.sfx, ev.x, ev.y);
    if (c.heal) d.effects.heal(c.heal * power);
    if (c.shield) this.shield(c.shield, now);
    if (c.bullets) this.bullets(ev, c.bullets, dmg);
    if (c.screenStrike) for (const e of d.enemiesOnScreen()) d.damageEnemy(e, dmg, e.x - d.player.x, e.y - d.player.y);
    if (c.mine) d.mines.place(ev.x, ev.y, { faction: 'ally', ...c.mine, damage: dmg }, now);
    if (c.fly) this.add(this.flyer(ev, c.fly, now));
    if (c.dropShadow) this.add(this.dropShadow(ev, c.dropShadow, now));
    if (c.prop) this.add(this.prop(ev, c.prop, now));
    if (c.countdown) this.add(this.countdown(ev, c.countdown, now));
    if (c.gunner) this.add(this.gunner(c.gunner, dmg, now));
    if (c.edgeFlash) this.add(this.edgeFlash(c.edgeFlash, now));
    if (c.arc) this.add(this.arc(ev, c.arc, now));
    if (c.fall) this.add(this.fall(ev, c.fall, now));
    if (c.dash) this.add(this.dash(ev, c.dash, dmg, power, now));
    if (c.hook) d.scene.events.emit('timeline:hook', c.hook, ev);
  }

  /** 타임라인 밖에서 큐 하나만 실행(지뢰 폭발 연출 등). 피해는 호출부가 */
  cue(name: string, x: number, y: number): void {
    this.fire({ atMs: 0, cue: name, x, y, damage: 0, radius: 0, durationMs: 0, index: 0, count: 1, dirX: 1, dirY: 0 }, 1);
  }

  private add(a: Actor): void {
    this.actors.push(a);
  }

  /** 매 프레임(전투 시계): 타임라인 진행 + 연출 물체 */
  update(): void {
    const now = this.d.clock.timeMs;
    this.ground.clear();
    this.air.clear();
    this.screen.clear();
    for (const r of this.runs) this.fireDue(r, now);
    this.runs = this.runs.filter((r) => !r.player.done);
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i] as Actor;
      if (a.update(now)) continue;
      a.destroy();
      this.actors.splice(i, 1);
    }
  }

  // ── 원자 동작 ──────────────────────────────────────────────

  private sprite(sheet: string, frame = 0): Phaser.GameObjects.Sprite {
    return this.sprites
      .acquire()
      .setTexture(manifest.fx(sheet).key, frame)
      .setOrigin(0.5)
      .setScrollFactor(1)
      .setFlip(false, false)
      .clearTint()
      .setAlpha(1)
      .setActive(true)
      .setVisible(true);
  }

  private release(s: Phaser.GameObjects.Sprite): void {
    s.setActive(false).setVisible(false);
    this.sprites.release(s);
  }

  private get view(): Phaser.Geom.Rectangle {
    return this.d.scene.cameras.main.worldView;
  }

  /** 비행체: 화면 바깥 → 반대편 바깥(카메라를 따라감). down은 위→아래, left·right는 가로 */
  private flyer(ev: FiredEvent, f: NonNullable<CueDef['fly']>, start: number): Actor {
    const spec = manifest.fx(f.sprite);
    const s = this.sprite(f.sprite, f.frame ?? 0).setScale(f.scale);
    const dir = f.dir ?? 'down';
    s.setFlip(dir === 'right', dir === 'down');
    if (f.shadow) applyLayer(s.setTintFill(0x000000), 'shadow', f.alpha ?? 0.35);
    else applyLayer(s, 'air', f.alpha ?? 1);
    const margin = (spec.frameSize * f.scale) / 2;
    const x0 = ev.x + (f.dx ?? 0);
    const y0 = ev.y + (f.dy ?? 0);
    return {
      update: (now) => {
        const k = (now - start) / f.ms;
        if (k >= 1) return false;
        const v = this.view;
        if (dir === 'down') s.setPosition(x0, v.y - margin + k * (v.height + margin * 2));
        else {
          const t = dir === 'left' ? 1 - k : k;
          s.setPosition(v.x - margin + t * (v.width + margin * 2), y0);
        }
        // 그림자는 지나가며 조금씩 커진다(고도가 낮아지는 느낌)
        if (f.grow) s.setScale(f.scale * (1 + f.grow * k));
        return true;
      },
      destroy: () => this.release(s),
    };
  }

  /** 낙하물 그림자: from → to 반지름으로 커짐 */
  private dropShadow(ev: FiredEvent, c: NonNullable<CueDef['dropShadow']>, start: number): Actor {
    return {
      update: (now) => {
        const k = (now - start) / c.ms;
        if (k >= 1) return false;
        const r = c.from + (c.to - c.from) * k;
        this.ground.fillStyle(0x000000, 0.25 + 0.2 * k).fillEllipse(ev.x, ev.y, r * 2, r);
        return true;
      },
      destroy: () => undefined,
    };
  }

  /** 설치물: frames 구간 반복, 재생 속도 fps → fpsEnd(점멸 가속) */
  private prop(ev: FiredEvent, p: NonNullable<CueDef['prop']>, start: number): Actor {
    const [first = 0, last = first] = p.frames;
    const span = last - first + 1;
    const s = this.sprite(p.sheet, first).setScale(p.scale).setOrigin(0.5, 0.85).setPosition(ev.x, ev.y).setDepth(Depth.Unit);
    let phase = 0;
    let lastMs = start;
    return {
      update: (now) => {
        const k = (now - start) / p.ms;
        if (k >= 1) return false;
        phase += ((now - lastMs) / 1000) * (p.fps + ((p.fpsEnd ?? p.fps) - p.fps) * k);
        lastMs = now;
        s.setFrame(first + (Math.floor(phase) % span));
        return true;
      },
      destroy: () => this.release(s),
    };
  }

  /** 머리 위 숫자 카운트(1초마다, 삑 소리 음높이 상승) */
  private countdown(ev: FiredEvent, c: NonNullable<CueDef['countdown']>, start: number): Actor {
    const text = this.d.scene.add.bitmapText(ev.x, ev.y - 44, PIXEL_FONT, '', 7).setOrigin(0.5).setLetterSpacing(-1).setDepth(Depth.DamageText);
    let shown = 0;
    return {
      update: (now) => {
        const n = c.from - Math.floor((now - start) / 1000);
        if (n <= 0) return false;
        if (n !== shown) {
          shown = n;
          text.setText(String(n)).setTint(n === 1 ? 0xff5040 : 0xffffff);
          if (c.sfx) this.d.audio.play(c.sfx, ev.x, ev.y, { combo: c.from - n + 1 });
        }
        const pop = Math.min(1, ((now - start) % 1000) / 150);
        text.setScale(3 * (1.3 - 0.3 * pop));
        return true;
      },
      destroy: () => text.destroy(),
    };
  }

  /** 플레이어에게서 조준 방향 부채꼴 일제 사격 */
  private bullets(ev: FiredEvent, b: NonNullable<CueDef['bullets']>, dmg: number): void {
    const p = this.d.player;
    const base = Math.atan2(ev.dirY, ev.dirX);
    const spread = (b.spreadDeg * Math.PI) / 180;
    for (let i = 0; i < b.count; i++) {
      const a = base + (b.count > 1 ? spread * (i / (b.count - 1) - 0.5) : 0);
      this.d.effects.fireBullet(p.x + Math.cos(a) * 100, p.y + Math.sin(a) * 100, dmg, b.rangePx);
    }
    if (b.muzzle) {
      const facing = ev.dirX < 0 ? -1 : 1;
      p.faceTowards(p.x + facing);
      p.fireAnim(this.d.clock.timeMs);
      this.d.feel.muzzle(p.x + facing * 22, p.y - combat.bodyOffsetY, facing, p.y);
    }
  }

  /** 지원군 사수: 화면 가장자리(화면 고정)에서 미끄러져 들어와 사격 후 퇴장. 탄환은 월드 좌표로 */
  private gunner(g: NonNullable<CueDef['gunner']>, dmg: number, start: number): Actor {
    const cam = this.d.scene.cameras.main;
    const [sx = 0, sy = 0] = g.screen;
    const [ox = 0, oy = 0] = g.slide;
    const s = this.sprite('support_volley', 0).setScale(g.scale).setScrollFactor(0).setFlipX(g.face < 0).setDepth(Depth.Player + 2);
    const flag = COUNTRIES[Math.floor(this.d.rng.next() * COUNTRIES.length)] ?? 0xffffff;
    let nextShot = start + g.inMs;
    const end = g.inMs + g.fireMs + g.outMs;
    return {
      update: (now) => {
        const t = now - start;
        if (t >= end) return false;
        let k = 1;
        if (t < g.inMs) {
          k = t / g.inMs;
          s.setFrame(k < 0.5 ? 0 : 1);
        } else if (t < g.inMs + g.fireMs) {
          s.setFrame(2 + (Math.floor(t / 83) % 3));
          while (now >= nextShot) {
            nextShot += g.intervalMs;
            const w = cam.getWorldPoint(sx + g.face * 30, sy - 8);
            const feetY = w.y + combat.bodyOffsetY;
            const target = this.d.grid.nearest(w.x, feetY, g.rangePx, (e) => e.alive);
            if (target) {
              this.d.effects.fireBulletFrom(w.x, feetY, target.x, target.y, dmg, g.rangePx);
              this.d.audio.play('shot', w.x, w.y);
              this.d.feel.particles.emit('casing', w.x - g.face * 16, feetY, 1, combat.bodyOffsetY, -g.face, -0.6);
            }
          }
        } else {
          k = 1 - (t - g.inMs - g.fireMs) / g.outMs;
          s.setFrame(5);
        }
        // 슬라이드인(투명 0 → 100%) / 퇴장은 반대로
        s.setPosition(sx + ox * (1 - k), sy + oy * (1 - k)).setAlpha(k);
        // 참전국 구분: 어깨의 작은 색 띠(국기 패치 자리표시자)
        if (k > 0.5) this.screen.fillStyle(flag, k).fillRect(Math.round(s.x - g.face * 14), Math.round(s.y - 22), 5, 3);
        return true;
      },
      destroy: () => this.release(s),
    };
  }

  /** 화면 밖 섬광: 가장자리 띠가 짧게 밝아짐(화면 고정) */
  private edgeFlash(f: NonNullable<CueDef['edgeFlash']>, start: number): Actor {
    const color = parseColor(f.color);
    const W = this.d.scene.scale.gameSize.width;
    return {
      update: (now) => {
        const k = (now - start) / f.ms;
        if (k >= 1) return false;
        const x = f.side === 'left' ? 0 : W - f.width;
        for (let i = 0; i < 4; i++) {
          // 바깥쪽이 밝고 안쪽으로 옅어지는 4단 띠
          const w = f.width / 4;
          const bx = f.side === 'left' ? x + i * w : x + f.width - (i + 1) * w;
          this.screen.fillStyle(color, (1 - k) * (0.8 - i * 0.18)).fillRect(Math.round(bx), 0, Math.ceil(w), LOGICAL_HEIGHT);
        }
        return true;
      },
      destroy: () => undefined,
    };
  }

  /** 포탄 포물선: 화면 가장자리 → 이벤트 위치, durationMs(앞당긴 큐의 lead) 동안 */
  private arc(ev: FiredEvent, a: NonNullable<CueDef['arc']>, start: number): Actor {
    const v = this.view;
    const fromX = a.side === 'left' ? v.x - 20 : v.right + 20;
    const fromY = Math.max(v.y + 40, ev.y - 100);
    const dur = Math.max(1, ev.durationMs);
    let nextSmoke = start;
    return {
      update: (now) => {
        const k = (now - start) / dur;
        if (k >= 1) return false;
        const gx = fromX + (ev.x - fromX) * k;
        const gy = fromY + (ev.y - fromY) * k;
        const h = Math.sin(k * Math.PI) * a.height;
        this.air.fillStyle(0x2e2a26, 1).fillCircle(gx, gy - h, 3).fillStyle(0xa09a90, 1).fillCircle(gx - 1, gy - h - 1, 1);
        if (now >= nextSmoke) {
          nextSmoke = now + 60;
          this.d.feel.particles.emit('smoke', gx, gy, 1, h);
        }
        return true;
      },
      destroy: () => undefined,
    };
  }

  /** 낙하산 보급 상자: 위에서 이벤트 위치로 durationMs 동안 흔들리며 내려옴 */
  private fall(ev: FiredEvent, f: NonNullable<CueDef['fall']>, start: number): Actor {
    const [first = 0, last = first] = f.frames;
    const s = this.sprite(f.sheet, first).setScale(f.scale).setOrigin(0.5, 0.9).setDepth(Depth.Air);
    const dur = Math.max(1, ev.durationMs);
    return {
      update: (now) => {
        const t = now - start;
        const k = t / dur;
        if (k >= 1) return false;
        s.setFrame(first + (Math.floor((t / 1000) * f.fps) % (last - first + 1)));
        s.setPosition(ev.x + Math.sin(t / 180) * 4, ev.y - f.height * (1 - k));
        this.ground.fillStyle(0x000000, 0.2 + 0.2 * k).fillEllipse(ev.x, ev.y, 10 + 10 * k, 5 + 5 * k);
        return true;
      },
      destroy: () => this.release(s),
    };
  }

  /**
   * 돌진(전차): 시전 순간 플레이어 위치를 지나 조준 방향으로 화면 끝에서 끝까지.
   * hit이면 지나가는 자리의 적에게 피해 + 진행 방향 넉백, trailCue를 trailEveryPx마다(흙먼지·지뢰).
   */
  private dash(ev: FiredEvent, c: NonNullable<CueDef['dash']>, dmg: number, power: number, start: number): Actor {
    const v = this.view;
    const [fdx, fdy] = c.dir ?? [];
    const ux = fdx ?? ev.dirX;
    const uy = fdy ?? ev.dirY;
    // 화면 경계(+여유)까지의 거리
    const toEdge = (dx: number, dy: number): number => {
      const hw = v.width / 2 + c.margin;
      const hh = v.height / 2 + c.margin;
      const cx = ev.x - v.centerX;
      const cy = ev.y - v.centerY;
      const tx = dx > 0 ? (hw - cx) / dx : dx < 0 ? (-hw - cx) / dx : Infinity;
      const ty = dy > 0 ? (hh - cy) / dy : dy < 0 ? (-hh - cy) / dy : Infinity;
      return Math.max(0, Math.min(tx, ty));
    };
    const back = toEdge(-ux, -uy);
    const len = back + toEdge(ux, uy);
    const sx = ev.x - ux * back;
    const sy = ev.y - uy * back;
    const ms = (len / c.speed) * 1000;
    const [f0 = 0, f1 = 5] = c.frames ?? [];
    const s = this.sprite(c.sprite, f0).setScale(c.scale);
    if (c.layer === 'air') applyLayer(s.setOrigin(0.5), 'air', 1);
    else s.setOrigin(0.5, 0.8).setDepth(Depth.Player + 1);
    if (c.orient === 'top') s.setFlipY(uy > 0);
    else s.setFlipX(ux < 0);
    const lastHit = new Map<Enemy, number>();
    const half = c.width / 2;
    // 피해 띠: 기본은 몸체 자리, reach가 있으면 앞쪽 reach 길이(기총 탄착)
    const reach = c.reach ?? 0;
    let nextTrail = reach;
    return {
      update: (now) => {
        const t = now - start;
        const k = t / ms;
        if (k >= 1) return false;
        const dist = len * k;
        const x = sx + ux * dist;
        const y = sy + uy * dist;
        s.setPosition(x, y).setFrame(f0 + (Math.floor((t / 1000) * c.fps) % (f1 - f0 + 1)));
        if (c.hit && dmg > 0) {
          const mx = x + ux * reach * 0.5;
          const my = y + uy * reach * 0.5;
          this.d.grid.forEachNear(mx, my, reach * 0.5 + half + MAX_ENEMY_RADIUS, (e) => {
            if (!e.alive) return;
            const prev = lastHit.get(e);
            if (prev !== undefined && (c.tickMs === undefined || now - prev < c.tickMs)) return;
            // 띠(선분 x,y → x+u·reach)까지 거리
            const along = Math.max(0, Math.min(reach, (e.x - x) * ux + (e.y - y) * uy));
            const r = half + e.radius;
            if ((e.x - (x + ux * along)) ** 2 + (e.y - (y + uy * along)) ** 2 > r * r) return;
            lastHit.set(e, now);
            this.d.damageEnemy(e, dmg, ux, uy);
            if (e.alive && c.knockback > 0) startKnockback(e.kb, ux, uy, c.knockback, 220);
          });
        }
        if (c.trailCue && c.trailEveryPx) {
          while (dist + reach >= nextTrail) {
            const at = { ...ev, cue: c.trailCue, x: sx + ux * nextTrail, y: sy + uy * nextTrail, durationMs: 0, damage: c.hit ? 0 : ev.damage };
            nextTrail += c.trailEveryPx;
            // 화면 밖 구간은 건너뜀(지뢰가 보이지 않는 곳에 깔리지 않게)
            if (v.contains(at.x, at.y)) this.fire(at, power);
          }
        }
        return true;
      },
      destroy: () => this.release(s),
    };
  }

  /** 보호막: 플레이어 발밑 따뜻한 색 오라 */
  private shield(c: NonNullable<CueDef['shield']>, start: number): void {
    const p = this.d.player;
    p.shieldUntilMs = Math.max(p.shieldUntilMs, start + c.ms);
    const color = parseColor(c.color);
    this.add({
      update: (now) => {
        if (now >= p.shieldUntilMs) return false;
        const pulse = 0.5 + 0.3 * Math.sin(now / 90);
        this.ground.lineStyle(2, color, pulse).strokeEllipse(p.x, p.y - 2, 44, 20);
        this.ground.fillStyle(color, 0.12).fillEllipse(p.x, p.y - 2, 44, 20);
        return true;
      },
      destroy: () => undefined,
    });
  }
}
