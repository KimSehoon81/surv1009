import type * as Phaser from 'phaser';
import { CappedPool } from '../core/pool';
import { fadeAlpha, parseColor } from '../core/feel';
import type { Rng } from '../core/rng';
import { Depth } from '../config/depth';

/** feel.json particles.kinds 한 항목 */
export interface ParticleKindData {
  texture: string;
  tints: string[];
  speed: number[];
  lifeMs: number[];
  scale: number[];
  alpha: number[];
  spread: number;
  depth: string;
  drag?: number;
  gravity?: number;
  vz?: number[];
  z0?: number;
  gravityZ?: number;
  bounce?: number;
  fadeFromK?: number;
  spin?: number;
  alignToVelocity?: boolean;
}

interface Kind {
  texture: string;
  tints: number[];
  data: ParticleKindData;
  depth: number;
}

interface Particle {
  img: Phaser.GameObjects.Image;
  kind: Kind;
  x: number;
  y: number;
  /** 지면에서 높이(px). 그릴 때 y - z */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ageMs: number;
  lifeMs: number;
  spin: number;
  bounced: boolean;
}

export const PARTICLE_TEXTURE_PREFIX = 'pt_';

const at = (a: readonly number[], i: number, fallback = 0): number => a[i] ?? fallback;

/** 스파크·연기·파편·탄피·땅 자국. 동시 개수 상한(PRD §4.4: 300)을 넘으면 가장 오래된 입자를 재사용 */
export class ParticleSystem {
  private readonly pool: CappedPool<Particle>;
  private readonly kinds = new Map<string, Kind>();

  constructor(
    scene: Phaser.Scene,
    cap: number,
    kinds: Record<string, ParticleKindData>,
    private readonly rng: Rng,
  ) {
    for (const [name, data] of Object.entries(kinds)) {
      const depth = (Depth as Record<string, number>)[data.depth];
      if (depth === undefined) throw new Error(`입자 ${name}: 알 수 없는 depth ${data.depth}`);
      this.kinds.set(name, { texture: PARTICLE_TEXTURE_PREFIX + data.texture, tints: data.tints.map(parseColor), data, depth });
    }
    const first = this.kinds.values().next().value as Kind;
    this.pool = new CappedPool<Particle>(
      () => ({
        img: scene.add.image(0, 0, first.texture).setActive(false).setVisible(false),
        kind: first,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        ageMs: 0,
        lifeMs: 1,
        spin: 0,
        bounced: false,
      }),
      cap,
    );
  }

  /** (x, y)는 지면(발) 좌표, height는 지면 위 높이. dir이 있으면 그 방향 ± spread/2로 퍼진다 */
  emit(kindName: string, x: number, y: number, count: number, height = 0, dirX = 0, dirY = 0): void {
    const kind = this.kinds.get(kindName);
    if (!kind || count <= 0) return;
    const d = kind.data;
    const base = dirX === 0 && dirY === 0 ? this.rng.next() * Math.PI * 2 : Math.atan2(dirY, dirX);
    for (let i = 0; i < count; i++) {
      const { item: p } = this.pool.acquire();
      const a = base + (this.rng.next() - 0.5) * d.spread;
      const sp = this.rng.range(at(d.speed, 0), at(d.speed, 1));
      p.kind = kind;
      p.x = x;
      p.y = y;
      p.z = height + (d.z0 ?? 0);
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.vz = d.vz ? this.rng.range(at(d.vz, 0), at(d.vz, 1)) : 0;
      p.ageMs = 0;
      p.lifeMs = Math.max(1, this.rng.range(at(d.lifeMs, 0, 300), at(d.lifeMs, 1, 300)));
      p.spin = d.spin ? (this.rng.next() - 0.5) * 2 * d.spin : 0;
      p.bounced = false;
      p.img
        .setTexture(kind.texture)
        .setTint(kind.tints[Math.floor(this.rng.next() * kind.tints.length)] ?? 0xffffff)
        .setDepth(kind.depth)
        .setRotation(d.alignToVelocity ? a : 0)
        .setActive(true)
        .setVisible(true);
      this.draw(p);
    }
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return;
    const dt = dtMs / 1000;
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Particle;
      const d = p.kind.data;
      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        p.img.setActive(false).setVisible(false);
        this.pool.release(p);
        continue;
      }
      const drag = Math.exp(-(d.drag ?? 0) * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + (d.gravity ?? 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (d.gravityZ !== undefined) {
        p.vz -= d.gravityZ * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          // 한 번 튀고 멈춘다(탄피·파편)
          if (!p.bounced && (d.bounce ?? 0) > 0) {
            p.vz = -p.vz * (d.bounce ?? 0);
            p.vx *= 0.5;
            p.vy *= 0.5;
            p.bounced = true;
          } else {
            p.vz = 0;
            p.vx = 0;
            p.vy = 0;
            p.spin = 0;
          }
        }
      }
      if (p.spin !== 0) p.img.rotation += p.spin * dt;
      this.draw(p);
    }
  }

  private draw(p: Particle): void {
    const d = p.kind.data;
    const k = p.ageMs / p.lifeMs;
    const s = at(d.scale, 0, 1) + (at(d.scale, 1, 1) - at(d.scale, 0, 1)) * k;
    p.img
      .setPosition(p.x, p.y - p.z)
      .setScale(s)
      .setAlpha(fadeAlpha(k, at(d.alpha, 0, 1), at(d.alpha, 1, 0), d.fadeFromK ?? 0));
  }

  clear(): void {
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Particle;
      p.img.setActive(false).setVisible(false);
      this.pool.release(p);
    }
  }

  get active(): number {
    return this.pool.size;
  }

  get cap(): number {
    return this.pool.cap;
  }
}

/** 입자용 작은 텍스처를 코드로 만든다(흰색 바탕 → tint로 색). 그래픽 에셋이 아니라 도트 단위 기본 도형 */
export function ensureParticleTextures(scene: Phaser.Scene): void {
  const make = (name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const key = PARTICLE_TEXTURE_PREFIX + name;
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, w, h);
    if (!tex) throw new Error(`입자 텍스처 생성 실패: ${key}`);
    draw(tex.getContext());
    tex.refresh();
  };
  const disc = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, dither = false) => {
    ctx.fillStyle = color;
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d > 1) continue;
        if (dither && d > 0.6 && (x + y) % 2 === 0) continue;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  };
  make('spark', 4, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 4, 2);
  });
  make('debris', 3, 3, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 3, 3);
    ctx.clearRect(2, 0, 1, 1);
  });
  make('casing', 3, 2, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 3, 2);
  });
  make('smoke', 12, 12, (ctx) => disc(ctx, 6, 6, 6, 6, '#ffffff', true));
  make('crater', 30, 14, (ctx) => {
    disc(ctx, 15, 7, 15, 7, 'rgba(70,58,40,0.55)', true);
    disc(ctx, 15, 7.5, 11, 5, 'rgba(32,26,20,0.85)');
    disc(ctx, 14, 6.5, 6, 2.5, 'rgba(18,14,10,0.9)');
  });
}
