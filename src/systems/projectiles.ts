import * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import { parseColor } from '../core/feel';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import type { SpatialHash } from '../core/spatialHash';
import { Depth } from '../config/depth';
import combat from '../data/combat.json';
import { MAX_ENEMY_RADIUS, type Enemy } from '../entities/Enemy';

/** 투사체가 적을 맞혔을 때(직선) / 착지했을 때(곡사) 전투 로직에 알린다 */
export interface ProjectileHooks {
  /** (dirX, dirY): 투사체 진행 방향(넉백·스파크 방향) */
  onHit(e: Enemy, damageMult: number, dirX: number, dirY: number, tag: string | undefined): void;
  onLand(x: number, y: number, radius: number, damageMult: number, fx: string | undefined, fxScale: number, impact: string | undefined, tag: string | undefined): void;
  /** 직선 탄이 장애물에 닿음(발 기준 좌표) → true면 탄 소멸. 곡사는 묻지 않음 */
  blocked?(x: number, feetY: number, damageMult: number): boolean;
}

interface Projectile {
  sprite: Phaser.GameObjects.Image;
  lob: boolean;
  // 직선: 몸통 높이 좌표(발 기준 y - bodyOffset)로 날아간다
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  radius: number;
  pierceLeft: number;
  damageMult: number;
  hit: Set<Enemy>;
  /** 맞힌 자리 범위 폭발(바주카 등) */
  explode: ExplodeSpec | undefined;
  // 곡사: 발 기준 출발점·도착점
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  flightMs: number;
  arc: number;
  aoe: number;
  fx: string | undefined;
  fxScale: number;
  impact: string | undefined;
  /** 피해 출처 표시(실패 잔효 피해 집계 등) */
  tag: string | undefined;
}

export interface ExplodeSpec {
  radius: number;
  damageMult: number;
  fx?: string;
  fxScale?: number;
  impact?: string;
}

export interface BulletSpec {
  sprite: string;
  scale: number;
  speed: number;
  radius: number;
  pierce: number;
  damageMult: number;
  rangePx: number;
  tag?: string;
  explode?: ExplodeSpec;
}

export interface LobSpec {
  sprite: string;
  scale: number;
  flightMs: number;
  arcHeight: number;
  aoeRadius: number;
  damageMult: number;
  fx: string | undefined;
  fxScale: number;
  /** 착지 지점 연출 프리셋(feel.json) */
  impact: string | undefined;
  tag?: string;
}


const TRACER = feelData.tracer;
const TRACER_CORE = parseColor(TRACER.core);
const TRACER_GLOW = parseColor(TRACER.glow);

/** 직선 투사체(총알)와 곡사 투사체(수류탄). 스프라이트는 풀에서 재사용 */
export class ProjectileSystem {
  private readonly pool: Pool<Projectile>;
  /** 예광탄 궤적(총알 뒤로 밝은 줄): 한 그래픽에 모아 그림 */
  private readonly trail: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private readonly bodyOffsetY: number,
  ) {
    this.trail = scene.add.graphics().setDepth(Depth.Projectile - 1).setBlendMode(Phaser.BlendModes.ADD);
    this.pool = new Pool(
      () => ({
        sprite: scene.add.image(0, 0, '__DEFAULT').setActive(false).setVisible(false).setDepth(Depth.Projectile),
        lob: false, x: 0, y: 0, vx: 0, vy: 0, lifeMs: 0, radius: 4, pierceLeft: 0, damageMult: 1, hit: new Set<Enemy>(), explode: undefined,
        sx: 0, sy: 0, tx: 0, ty: 0, t: 0, flightMs: 1, arc: 0, aoe: 0, fx: undefined, fxScale: 1, impact: undefined, tag: undefined,
      }),
      96,
    );
  }

  get active(): number {
    return this.pool.size;
  }

  private take(spriteName: string, scale: number): Projectile {
    const p = this.pool.acquire();
    p.hit.clear();
    p.sprite.setTexture(manifest.image('ui', spriteName, 32, 32).key).setScale(scale).setActive(true).setVisible(true).setRotation(0);
    return p;
  }

  /** (fromX, fromY) 발 기준 → 목표 발 기준 좌표로 총알 발사 */
  fireBullet(spec: BulletSpec, fromX: number, fromY: number, toX: number, toY: number): void {
    const p = this.take(spec.sprite, spec.scale);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy) || 1;
    p.lob = false;
    p.x = fromX;
    p.y = fromY - this.bodyOffsetY;
    p.vx = (dx / len) * spec.speed;
    p.vy = (dy / len) * spec.speed;
    p.lifeMs = (spec.rangePx / spec.speed) * 1000 * combat.bulletLifeSlack;
    p.radius = spec.radius;
    p.pierceLeft = spec.pierce;
    p.damageMult = spec.damageMult;
    p.tag = spec.tag;
    p.explode = spec.explode;
    p.sprite.setPosition(p.x, p.y).setRotation(Math.atan2(dy, dx));
  }

  /** 발 기준 출발점 → 도착점으로 곡사 */
  lob(spec: LobSpec, fromX: number, fromY: number, toX: number, toY: number): void {
    const p = this.take(spec.sprite, spec.scale);
    p.lob = true;
    p.sx = fromX;
    p.sy = fromY;
    p.tx = toX;
    p.ty = toY;
    p.t = 0;
    p.flightMs = spec.flightMs;
    p.arc = spec.arcHeight;
    p.aoe = spec.aoeRadius;
    p.damageMult = spec.damageMult;
    p.fx = spec.fx;
    p.fxScale = spec.fxScale;
    p.impact = spec.impact;
    p.tag = spec.tag;
    p.explode = undefined;
    p.sprite.setPosition(fromX, fromY - this.bodyOffsetY);
  }

  update(dtMs: number, grid: SpatialHash<Enemy>, hooks: ProjectileHooks): void {
    // 멈춘 동안(히트스톱·일시정지)은 궤적도 그대로 둔다
    if (dtMs <= 0) return;
    const tr = this.trail.clear();
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Projectile;
      if (p.lob) {
        p.t += dtMs;
        const k = Math.min(1, p.t / p.flightMs);
        const gx = p.sx + (p.tx - p.sx) * k;
        const gy = p.sy + (p.ty - p.sy) * k;
        const h = Math.sin(k * Math.PI) * p.arc;
        p.sprite.setPosition(gx, gy - this.bodyOffsetY * (1 - k) - h).setRotation(k * Math.PI * 4);
        if (k >= 1) {
          hooks.onLand(p.tx, p.ty, p.aoe, p.damageMult, p.fx, p.fxScale, p.impact, p.tag);
          this.release(p);
        }
        continue;
      }
      p.x += (p.vx * dtMs) / 1000;
      p.y += (p.vy * dtMs) / 1000;
      p.lifeMs -= dtMs;
      p.sprite.setPosition(p.x, p.y);
      // 예광탄: 속도에 비례한 길이, 번진 주황 위에 밝은 심
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const len = Math.min(TRACER.maxPx, Math.max(TRACER.minPx, sp * TRACER.lenSec));
      const bx = p.x - (p.vx / sp) * len;
      const by = p.y - (p.vy / sp) * len;
      tr.lineStyle(TRACER.glowWidth, TRACER_GLOW, TRACER.glowAlpha).lineBetween(bx, by, p.x, p.y);
      tr.lineStyle(TRACER.coreWidth, TRACER_CORE, 1).lineBetween(bx + (p.x - bx) * 0.35, by + (p.y - by) * 0.35, p.x, p.y);
      // 적 위치는 발 기준이므로 투사체 높이를 발 기준으로 바꿔 질의
      const feetY = p.y + this.bodyOffsetY;
      if (hooks.blocked?.(p.x, feetY, p.damageMult)) {
        this.release(p);
        continue;
      }
      let done = false;
      grid.forEachNear(p.x, feetY, p.radius + MAX_ENEMY_RADIUS, (e, d2) => {
        if (!e.alive || p.hit.has(e) || (e.air && p.tag !== 'aa')) return;
        const r = p.radius + e.radius;
        if (d2 > r * r) return;
        p.hit.add(e);
        hooks.onHit(e, p.damageMult, p.vx, p.vy, p.tag);
        const ex = p.explode;
        if (ex) hooks.onLand(e.x, e.y, ex.radius, p.damageMult * ex.damageMult, ex.fx, ex.fxScale ?? 1, ex.impact, p.tag);
        if (p.pierceLeft-- <= 0) {
          done = true;
          return true;
        }
      });
      if (done || p.lifeMs <= 0) this.release(p);
    }
  }

  private release(p: Projectile): void {
    p.sprite.setActive(false).setVisible(false);
    this.pool.release(p);
  }

  clear(): void {
    this.trail.clear();
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) this.release(list[i] as Projectile);
  }
}
