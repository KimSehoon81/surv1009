// 처치 잔상(2026-11-14): 쓰러진 적의 그 순간 모습이 맞은 방향으로 튕겨 날아가며 흰 섬광 → 옅어져 사라진다.
// 시체는 남지 않고(PRD §1) 0.24초면 끝. 수치는 feel.json killGhost, 동시 상한 cap
import type * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import { Depth } from '../config/depth';

const G = feelData.killGhost;

interface Ghost {
  s: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  ux: number;
  uy: number;
  sx: number;
  sy: number;
  born: number;
  on: boolean;
  white: boolean;
}

export class KillGhosts {
  private readonly list: Ghost[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** 이 등급의 적이 잔상을 남기는지(정예·보스는 큰 폭발 연출이 따로) */
  static wants(tier: string): boolean {
    return (G.tiers as string[]).includes(tier);
  }

  get active(): number {
    return this.list.filter((g) => g.on).length;
  }

  /** src(쓰러진 적 스프라이트)의 지금 프레임 그대로 잔상을 만들어 (dirX, dirY) 쪽으로 날림. 방향을 모르면 제자리에서 살짝 튐 */
  launch(src: Phaser.GameObjects.Sprite, dirX: number, dirY: number, nowMs: number): void {
    let g = this.list.find((x) => !x.on);
    if (!g) {
      if (this.list.length >= G.cap) return;
      g = { s: this.scene.add.sprite(0, 0, src.texture.key).setVisible(false), x: 0, y: 0, ux: 0, uy: 0, sx: 1, sy: 1, born: 0, on: false, white: false };
      this.list.push(g);
    }
    const len = Math.hypot(dirX, dirY);
    g.ux = len > 0.001 ? dirX / len : 0;
    g.uy = len > 0.001 ? dirY / len : 0;
    g.x = src.x;
    g.y = src.y;
    g.sx = Math.abs(src.scaleX) || 1;
    g.sy = Math.abs(src.scaleY) || 1;
    g.born = nowMs;
    g.on = true;
    g.white = true;
    g.s
      .setTexture(src.texture.key, src.frame.name)
      .setOrigin(src.originX, src.originY)
      .setFlipX(src.flipX)
      .setPosition(src.x, src.y)
      .setScale(g.sx, g.sy)
      .setRotation(0)
      .setAlpha(1)
      .setTintFill(0xffffff)
      .setDepth(Depth.Unit + 0.95)
      .setVisible(true);
  }

  update(nowMs: number): void {
    for (const g of this.list) {
      if (!g.on) continue;
      const age = nowMs - g.born;
      const k = age / G.ms;
      if (k >= 1 || age < 0) {
        g.on = false;
        g.s.setVisible(false);
        continue;
      }
      // 처음 빠르고 끝에 느려지는 밀림 + 작은 포물선, 뒤로 넘어가듯 기울며 납작해짐
      const e = 1 - (1 - k) * (1 - k);
      if (g.white && age >= G.whiteMs) {
        g.white = false;
        g.s.clearTint();
      }
      const side = g.ux === 0 ? (g.s.flipX ? 1 : -1) : Math.sign(g.ux);
      g.s
        .setPosition(Math.round(g.x + g.ux * G.distPx * e), Math.round(g.y + g.uy * G.distPx * 0.7 * e - Math.sin(k * Math.PI) * G.hopPx))
        .setRotation(side * G.spin * e)
        .setScale(g.sx * (1 + (1 - G.squash) * e), g.sy * (1 - (1 - G.squash) * e))
        .setAlpha(k < 0.4 ? 1 : 1 - (k - 0.4) / 0.6);
    }
  }

  clear(): void {
    for (const g of this.list) {
      g.on = false;
      g.s.setVisible(false);
    }
  }

  destroy(): void {
    for (const g of this.list) g.s.destroy();
    this.list.length = 0;
  }
}
