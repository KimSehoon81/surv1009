import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import { oldestPair, pickupScale } from '../core/pickupMerge';
import { Depth } from '../config/depth';

interface Pickup {
  sprite: Phaser.GameObjects.Image;
  value: number;
  bornMs: number;
  attracted: boolean;
  speed: number;
}

export interface PickupConfig {
  cap: number;
  collectRadius: number;
  pullSpeed: number;
  accel: number;
  /** 흡수 최고·최저 속도(pullSpeed 배수) */
  maxSpeedMul: number;
  minSpeedMul: number;
}

const BASE_SCALE = 0.5;

/** 경험치 보급품(별). 플레이어 자석 범위에 들어오면 끌려와 흡수된다. 상한을 넘으면 오래된 것끼리 병합 */
export class PickupSystem {
  private readonly pool: Pool<Pickup>;
  private readonly key = manifest.image('ui', 'star_xp', 32, 32).key;

  constructor(
    scene: Phaser.Scene,
    private readonly cfg: PickupConfig,
  ) {
    this.pool = new Pool(
      () => ({
        sprite: scene.add.image(0, 0, this.key).setActive(false).setVisible(false).setOrigin(0.5, 0.8).setDepth(Depth.Decal + 1),
        value: 1,
        bornMs: 0,
        attracted: false,
        speed: 0,
      }),
      cfg.cap,
    );
  }

  get active(): number {
    return this.pool.size;
  }

  drop(x: number, y: number, value: number, nowMs: number): void {
    if (this.pool.size >= this.cfg.cap) {
      const pair = oldestPair(this.pool.active);
      if (pair) {
        const from = this.pool.active[pair.remove] as Pickup;
        const into = this.pool.active[pair.into] as Pickup;
        into.value += from.value;
        into.sprite.setScale(pickupScale(into.value, BASE_SCALE));
        this.release(from);
      }
    }
    const p = this.pool.acquire();
    p.value = value;
    p.bornMs = nowMs;
    p.attracted = false;
    p.speed = 0;
    p.sprite.setPosition(x, y).setScale(pickupScale(value, BASE_SCALE)).setActive(true).setVisible(true);
  }

  /** 흡수한 경험치 합계를 돌려준다 */
  /** 떨어진 보급품 전부를 플레이어 쪽으로 끌어오기 시작(레벨업 대체 보상) */
  attractAll(): void {
    for (const p of this.pool.active) p.attracted = true;
  }

  update(dtMs: number, px: number, py: number, magnet: number): number {
    if (dtMs <= 0) return 0;
    let gained = 0;
    const list = this.pool.active;
    const dt = dtMs / 1000;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i] as Pickup;
      const dx = px - p.sprite.x;
      const dy = py - p.sprite.y;
      const d = Math.hypot(dx, dy);
      if (d <= this.cfg.collectRadius) {
        gained += p.value;
        this.release(p);
        continue;
      }
      if (!p.attracted && d <= magnet) p.attracted = true;
      if (p.attracted) {
        p.speed = Math.min(p.speed + this.cfg.accel * dt, this.cfg.pullSpeed * this.cfg.maxSpeedMul);
        const step = Math.min(d, Math.max(this.cfg.pullSpeed * this.cfg.minSpeedMul, p.speed) * dt);
        p.sprite.setPosition(p.sprite.x + (dx / d) * step, p.sprite.y + (dy / d) * step);
      }
    }
    return gained;
  }

  private release(p: Pickup): void {
    p.sprite.setActive(false).setVisible(false);
    this.pool.release(p);
  }
}
