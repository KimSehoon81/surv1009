import type * as Phaser from 'phaser';
import { Pool } from '../core/pool';
import { Depth } from '../config/depth';
import { enemyMark } from '../ui/factionMark';

/** 피해 장판(화염 등): 수명 동안 tickMs마다 안에 있는 대상에게 피해. 이후 연기·독가스류도 같은 엔티티 */
export interface HazardSpec {
  kind: string;
  faction: 'ally' | 'enemy';
  radius: number;
  lifeMs: number;
  tickMs: number;
  /** enemy 장판: 공격력 값 / ally 장판: 공격력 배수 */
  damage: number;
}

interface Hazard {
  spec: HazardSpec;
  x: number;
  y: number;
  bornMs: number;
  nextTickMs: number;
}

export interface HazardHooks {
  /** 장판 안의 플레이어(enemy 장판) */
  hitPlayer(x: number, y: number, spec: HazardSpec): void;
}

const COLORS: Record<string, number[]> = { fire: [0xff7020, 0xffc040], gas: [0x80b040, 0xb0d060], smoke: [0x8a8478, 0xa49c8c] };

export class HazardSystem {
  private readonly pool = new Pool<Hazard>(() => ({ spec: { kind: 'fire', faction: 'enemy', radius: 0, lifeMs: 0, tickMs: 500, damage: 0 }, x: 0, y: 0, bornMs: 0, nextTickMs: 0 }), 8);
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private readonly cap = 24,
  ) {
    this.gfx = scene.add.graphics().setDepth(Depth.Decal + 1);
  }

  get active(): number {
    return this.pool.size;
  }

  place(x: number, y: number, spec: HazardSpec, nowMs: number): void {
    if (this.pool.size >= this.cap) {
      const oldest = this.pool.active[0];
      if (oldest) this.pool.release(oldest);
    }
    const h = this.pool.acquire();
    h.spec = spec;
    h.x = x;
    h.y = y;
    h.bornMs = nowMs;
    h.nextTickMs = nowMs;
  }

  update(nowMs: number, player: { x: number; y: number; radius: number }, hooks: HazardHooks): void {
    const g = this.gfx.clear();
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i] as Hazard;
      const age = nowMs - h.bornMs;
      if (age >= h.spec.lifeMs) {
        this.pool.release(h);
        continue;
      }
      // 일렁이는 바닥 불길(끝 0.5초는 사그라듦)
      const fade = Math.min(1, (h.spec.lifeMs - age) / 500);
      const [c1 = 0xff7020, c2 = 0xffc040] = COLORS[h.spec.kind] ?? [];
      const wob = 1 + 0.06 * Math.sin(nowMs / 90 + h.x);
      g.fillStyle(c1, 0.35 * fade).fillEllipse(h.x, h.y, h.spec.radius * 2 * wob, h.spec.radius * wob);
      g.fillStyle(c2, 0.3 * fade).fillEllipse(h.x, h.y, h.spec.radius * 1.2, h.spec.radius * 0.55);
      if (h.spec.faction === 'enemy') enemyMark(g, h.x, h.y, c1, 0.8 * fade);
      if (nowMs < h.nextTickMs) continue;
      h.nextTickMs = nowMs + h.spec.tickMs;
      if (h.spec.faction === 'enemy') {
        const r = h.spec.radius + player.radius;
        // 장판은 납작한 타원(세로 절반)
        if ((player.x - h.x) ** 2 + ((player.y - h.y) * 2) ** 2 <= r * r) hooks.hitPlayer(h.x, h.y, h.spec);
      }
    }
  }
}
