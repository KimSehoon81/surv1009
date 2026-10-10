import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import type { SpatialHash } from '../core/spatialHash';
import { Depth } from '../config/depth';
import type { Enemy } from '../entities/Enemy';

/** 투사체가 적을 맞혔을 때(직선) / 착지했을 때(곡사) 전투 로직에 알린다 */
export interface ProjectileHooks {
  onHit(e: Enemy, damageMult: number): void;
  onLand(x: number, y: number, radius: number, damageMult: number, fx: string | undefined, fxScale: number): void;
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
}

export interface BulletSpec {
  sprite: string;
  scale: number;
  speed: number;
  radius: number;
  pierce: number;
  damageMult: number;
  rangePx: number;
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
}

const MAX_ENEMY_RADIUS = 24;

/** 직선 투사체(총알)와 곡사 투사체(수류탄). 스프라이트는 풀에서 재사용 */
export class ProjectileSystem {
  private readonly pool: Pool<Projectile>;

  constructor(
    scene: Phaser.Scene,
    private readonly bodyOffsetY: number,
  ) {
    this.pool = new Pool(
      () => ({
        sprite: scene.add.image(0, 0, '__DEFAULT').setActive(false).setVisible(false).setDepth(Depth.Projectile),
        lob: false, x: 0, y: 0, vx: 0, vy: 0, lifeMs: 0, radius: 4, pierceLeft: 0, damageMult: 1, hit: new Set<Enemy>(),
        sx: 0, sy: 0, tx: 0, ty: 0, t: 0, flightMs: 1, arc: 0, aoe: 0, fx: undefined, fxScale: 1,
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
    p.lifeMs = (spec.rangePx / spec.speed) * 1000 * 1.15;
    p.radius = spec.radius;
    p.pierceLeft = spec.pierce;
    p.damageMult = spec.damageMult;
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
    p.sprite.setPosition(fromX, fromY - this.bodyOffsetY);
  }

  update(dtMs: number, grid: SpatialHash<Enemy>, hooks: ProjectileHooks): void {
    if (dtMs <= 0) return;
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
          hooks.onLand(p.tx, p.ty, p.aoe, p.damageMult, p.fx, p.fxScale);
          this.release(p);
        }
        continue;
      }
      p.x += (p.vx * dtMs) / 1000;
      p.y += (p.vy * dtMs) / 1000;
      p.lifeMs -= dtMs;
      p.sprite.setPosition(p.x, p.y);
      // 적 위치는 발 기준이므로 투사체 높이를 발 기준으로 바꿔 질의
      const feetY = p.y + this.bodyOffsetY;
      let done = false;
      grid.forEachNear(p.x, feetY, p.radius + MAX_ENEMY_RADIUS, (e, d2) => {
        if (!e.alive || p.hit.has(e)) return;
        const r = p.radius + e.radius;
        if (d2 > r * r) return;
        p.hit.add(e);
        hooks.onHit(e, p.damageMult);
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
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) this.release(list[i] as Projectile);
  }
}
