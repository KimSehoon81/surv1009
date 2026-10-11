import * as Phaser from 'phaser';
import { CappedPool } from '../core/pool';
import { fadeAlpha, parseColor } from '../core/feel';
import type { Rng } from '../core/rng';
import { Depth } from '../config/depth';
import { manifest } from '../assets/manifest';

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
  /** 'add'면 가산 혼합(섬광·빛 웅덩이) */
  blend?: 'add';
  /** 텍스처 프레임 수: 수명 비율에 따라 0→n-1로 넘김(링 확장 등) */
  frames?: number;
  /** 세로 배율(지면에 눕힌 타원) */
  flat?: number;
  /** true면 지면 높이에서 시작(타격 높이 무시) */
  ground?: boolean;
  /** 코드 텍스처 대신 이펙트 시트(public/assets/fx) 사용 */
  sheet?: string;
  /** 시트 프레임 중 하나를 무작위로(그을음 변형 등). frames(수명 따라 넘김)와 함께 쓰지 않음 */
  randomFrame?: boolean;
}

interface Kind {
  texture: string;
  /** 시트 프레임 수(randomFrame용) */
  sheetFrames: number;
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
      const sheet = data.sheet ? manifest.fx(data.sheet) : null;
      this.kinds.set(name, {
        texture: sheet ? sheet.key : PARTICLE_TEXTURE_PREFIX + data.texture,
        sheetFrames: sheet ? sheet.frames : 1,
        tints: data.tints.map(parseColor),
        data,
        depth,
      });
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
    if (d.ground) height = 0;
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
        .setTexture(kind.texture, d.randomFrame ? Math.floor(this.rng.next() * kind.sheetFrames) : d.frames || d.sheet ? 0 : undefined)
        .setBlendMode(d.blend === 'add' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
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
    if (d.frames) p.img.setFrame(Math.min(d.frames - 1, Math.floor(k * d.frames)));
    p.img
      .setPosition(p.x, p.y - p.z)
      .setScale(s, s * (d.flat ?? 1))
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
  // 프레임이 있는 텍스처: 가로로 이어 그리고 프레임 등록
  const makeFrames = (name: string, fw: number, fh: number, n: number, draw: (ctx: CanvasRenderingContext2D, i: number, ox: number) => void) => {
    const key = PARTICLE_TEXTURE_PREFIX + name;
    if (scene.textures.exists(key)) return;
    const tex = scene.textures.createCanvas(key, fw * n, fh);
    if (!tex) throw new Error(`입자 텍스처 생성 실패: ${key}`);
    for (let i = 0; i < n; i++) {
      draw(tex.getContext(), i, i * fw);
      tex.add(i, 0, i * fw, 0, fw, fh);
    }
    tex.refresh();
  };
  // 섬광: 꽉 찬 원판 → 작은 원판 → 디더 원판(가산 혼합으로 착탄 코어를 밝힘)
  makeFrames('flash', 24, 24, 3, (ctx, i, ox) => {
    const r = [11, 9, 7][i] ?? 7;
    disc(ctx, ox + 12, 12, r, r, '#ffffff', i === 2);
  });
  // 빛 웅덩이: 지면에 눕힌 넓은 타원(가산, 바닥 데칼층)
  make('glow', 48, 24, (ctx) => {
    disc(ctx, 24, 12, 24, 12, 'rgba(255,255,255,0.5)', true);
    disc(ctx, 24, 12, 16, 8, '#ffffff');
  });
  // 지면 충격파 링: 바닥에 눕힌 정수 픽셀 타원을 단계적으로 키운 6프레임(확대하지 않고 그려 도트 굵기가 고름)
  const ringR = [8, 16, 24, 32, 40, 48];
  makeFrames('ring', 100, 50, ringR.length, (ctx, i, ox) => {
    const rx = ringR[i] ?? 8;
    const ry = rx / 2;
    const th = i < 2 ? 2 : 1;
    const inside = (x: number, y: number) => ((x + 0.5 - 50) / rx) ** 2 + ((y + 0.5 - 25) / ry) ** 2 <= 1;
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 100; x++) {
        if (!inside(x, y)) continue;
        let edge = false;
        for (let k = 1; k <= th && !edge; k++) edge = !inside(x - k, y) || !inside(x + k, y) || !inside(x, y - k) || !inside(x, y + k);
        if (edge) ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  });
}
