// 장애물(D32): 청크마다 시드로 놓는 폐허 건물(정적) + 적이 세우는 바리케이드(수명·체력). 충돌 판정은 core/obstacles.
import type * as Phaser from 'phaser';
import { Depth } from '../config/depth';
import { manifest } from '../assets/manifest';
import { chunkObstacles, pointInRect, resolveCircle, segmentHitsRect, type ObstacleLayout, type Rect } from '../core/obstacles';

export interface ObstacleConfig extends ObstacleLayout {
  chunkPx: number;
  /** 몸통·윗면·테두리 색(그림이 오기 전 자리표시) */
  colors: { body: string; top: string; edge: string };
  /** 윗면 두께 px(입체감) */
  topPx: number;
  /** 폐허 그림(sprites/ruin_*.png)과 발판 높이 px. 모두 있으면 장애물 크기를 그림에 맞춤 */
  ruins?: { sprite: string; foot: number }[];
}

interface Placed {
  rect: Rect;
  gfx: Phaser.GameObjects.Graphics | Phaser.GameObjects.Image;
  barricade: boolean;
}

const hex = (c: string) => Number.parseInt(c.replace('#', ''), 16);
const KEEP_CHUNKS = 2;

export class ObstacleSystem {
  private readonly chunks = new Map<string, Placed[]>();
  private readonly barricades: Placed[] = [];
  /** 장애물이 하나라도 있는지(없으면 시야 검사를 건너뜀) */
  any = false;

  /** 폐허 그림 키(그림이 모두 있을 때만) */
  private readonly ruinKeys: string[] = [];
  private readonly layout: ObstacleConfig | null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: ObstacleConfig | null,
    private readonly seed: string,
  ) {
    const ruins = cfg?.ruins ?? [];
    const specs = ruins.map((r) => manifest.sprite(r.sprite));
    if (cfg && ruins.length > 0 && specs.every((s) => scene.textures.exists(s.key))) {
      this.ruinKeys = specs.map((s) => s.key);
      this.layout = { ...cfg, sizes: ruins.map((r, i) => [Math.max(16, (specs[i]?.width ?? 64) - 8), r.foot]) };
    } else this.layout = cfg;
  }

  get count(): number {
    let n = this.barricades.length;
    for (const c of this.chunks.values()) n += c.length;
    return n;
  }

  /** 화면 주변 청크 만들기·먼 청크 버리기, 수명 다한 바리케이드 치우기, 깊이 정렬 */
  update(cam: Phaser.Cameras.Scene2D.Camera, nowMs: number): void {
    const c = this.layout;
    if (c) {
      const x0 = Math.floor(cam.scrollX / c.chunkPx) - 1;
      const y0 = Math.floor(cam.scrollY / c.chunkPx) - 1;
      const x1 = Math.floor((cam.scrollX + cam.width) / c.chunkPx) + 1;
      const y1 = Math.floor((cam.scrollY + cam.height) / c.chunkPx) + 1;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = `${cx},${cy}`;
          if (!this.chunks.has(key)) this.chunks.set(key, chunkObstacles(cx, cy, c.chunkPx, c, this.seed).map((r) => this.place(r, false)));
        }
      }
      for (const [key, list] of this.chunks) {
        const [cx = 0, cy = 0] = key.split(',').map(Number);
        if (cx < x0 - KEEP_CHUNKS || cx > x1 + KEEP_CHUNKS || cy < y0 - KEEP_CHUNKS || cy > y1 + KEEP_CHUNKS) {
          for (const p of list) p.gfx.destroy();
          this.chunks.delete(key);
        }
      }
    }
    for (let i = this.barricades.length - 1; i >= 0; i--) {
      const b = this.barricades[i] as Placed;
      if ((b.rect.untilMs !== undefined && nowMs >= b.rect.untilMs) || (b.rect.hp !== undefined && b.rect.hp <= 0)) {
        b.gfx.destroy();
        this.barricades.splice(i, 1);
      }
    }
    const all = [...this.barricades, ...[...this.chunks.values()].flat()];
    this.any = all.length > 0;
    for (const p of all) p.gfx.setDepth(Depth.Unit + (p.rect.y + p.rect.h - cam.scrollY) * 0.001);
  }

  private place(r: Rect, barricade: boolean): Placed {
    const c = this.cfg;
    // 폐허 그림: 발판(충돌 사각형) 아래 가운데에 맞춰 세움
    const ruin = !barricade && r.look !== undefined ? this.ruinKeys[r.look] : undefined;
    if (ruin) return { rect: r, gfx: this.scene.add.image(r.x + r.w / 2, r.y + r.h, ruin).setOrigin(0.5, 1), barricade };
    const g = this.scene.add.graphics();
    const body = barricade ? 0x6a5030 : hex(c?.colors.body ?? '#4a443c');
    const top = barricade ? 0x8a6a40 : hex(c?.colors.top ?? '#6a6258');
    const edge = hex(c?.colors.edge ?? '#2a2420');
    const tp = barricade ? 4 : (c?.topPx ?? 10);
    g.fillStyle(body, 1).fillRect(r.x, r.y, r.w, r.h);
    g.fillStyle(top, 1).fillRect(r.x, r.y - tp, r.w, tp);
    g.lineStyle(1, edge, 1).strokeRect(r.x, r.y - tp, r.w, r.h + tp);
    if (barricade) for (let x = r.x + 6; x < r.x + r.w; x += 12) g.lineStyle(1, edge, 0.8).lineBetween(x, r.y - tp, x - 6, r.y + r.h);
    return { rect: r, gfx: g, barricade };
  }

  /** 바리케이드(E27 공병·E30 보스): 수명·체력 있는 장애물 */
  addBarricade(x: number, y: number, w: number, h: number, untilMs: number, hp: number): void {
    this.barricades.push(this.place({ x: Math.round(x - w / 2), y: Math.round(y - h / 2), w, h, untilMs, hp }, true));
  }

  /** (x, y) 반경 r 근처 장애물 */
  near(x: number, y: number, r: number): Rect[] {
    const out: Rect[] = [];
    for (const b of this.barricades) if (x + r > b.rect.x && x - r < b.rect.x + b.rect.w && y + r > b.rect.y && y - r < b.rect.y + b.rect.h) out.push(b.rect);
    const c = this.cfg;
    if (!c) return out;
    const cx0 = Math.floor((x - r) / c.chunkPx);
    const cx1 = Math.floor((x + r) / c.chunkPx);
    const cy0 = Math.floor((y - r) / c.chunkPx);
    const cy1 = Math.floor((y + r) / c.chunkPx);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) for (const p of this.chunks.get(`${cx},${cy}`) ?? []) out.push(p.rect);
    }
    return out;
  }

  resolve(x: number, y: number, r: number): { x: number; y: number; nx: number; ny: number } {
    const near = this.near(x, y, r);
    return near.length === 0 ? { x, y, nx: 0, ny: 0 } : resolveCircle(x, y, r, near);
  }

  /** 점이 장애물 안이면 그 장애물(직선 탄 차단) */
  at(x: number, y: number): Rect | null {
    return this.near(x, y, 1).find((b) => pointInRect(x, y, b)) ?? null;
  }

  /** 선분이 장애물에 막히는지(조준 사격) */
  blocks(x0: number, y0: number, x1: number, y1: number): boolean {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const r = Math.hypot(x1 - x0, y1 - y0) / 2;
    return this.near(mx, my, r).some((b) => segmentHitsRect(x0, y0, x1, y1, b));
  }

  /** 바리케이드에 피해(부서짐, 여유): 맞힌 것이 바리케이드면 true */
  damage(b: Rect, amount: number): boolean {
    if (b.hp === undefined) return false;
    b.hp -= amount;
    return true;
  }

  clear(): void {
    for (const list of this.chunks.values()) for (const p of list) p.gfx.destroy();
    this.chunks.clear();
    for (const b of this.barricades) b.gfx.destroy();
    this.barricades.length = 0;
  }
}
