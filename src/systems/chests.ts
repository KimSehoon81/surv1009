// 보물 상자(월드): 엘리트가 쓰러진 자리에 금테 상자 + 빛기둥·반짝임. 닿으면 전투가 HUD 상자 열기 연출을 띄움
import * as Phaser from 'phaser';
import chestData from '../data/chest.json';
import { Depth } from '../config/depth';

export const CHEST_KEY = 'treasure_chest';

interface Chest {
  x: number;
  y: number;
  bornMs: number;
  sprite: Phaser.GameObjects.Image;
}

export class ChestSystem {
  private list: Chest[] = [];
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(Depth.Decal + 2);
    ensureChestTexture(scene);
  }

  get count(): number {
    return this.list.length;
  }

  spots(): { x: number; y: number }[] {
    return this.list.map((c) => ({ x: c.x, y: c.y }));
  }

  /** 쓰러진 자리에 상자(살짝 튀어 오르며 등장) */
  spawn(x: number, y: number, nowMs: number): void {
    const sprite = this.scene.add.image(x, y, CHEST_KEY).setOrigin(0.5, 1).setDepth(Depth.Decal + 4).setScale(0);
    this.scene.tweens.add({ targets: sprite, scale: chestData.scale, duration: 260, ease: 'Back.out' });
    this.list.push({ x, y, bornMs: nowMs, sprite });
  }

  /** 매 프레임: 빛기둥·반짝임, 닿은 상자 하나를 돌려줌(그 상자는 없앰) */
  update(nowMs: number, player: { x: number; y: number }): { x: number; y: number } | null {
    const g = this.gfx.clear();
    let picked: { x: number; y: number } | null = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i] as Chest;
      const age = nowMs - c.bornMs;
      const left = chestData.lifeMs - age;
      if (left <= 0) {
        c.sprite.destroy();
        this.list.splice(i, 1);
        continue;
      }
      c.sprite.setVisible(left > 5000 || Math.floor(nowMs / 150) % 2 === 0);
      // 금빛 기둥(위로 옅어지는 사다리꼴) + 바닥 빛 + 반짝이는 점
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 200);
      g.fillStyle(0xffd34d, 0.1 + 0.06 * pulse).fillTriangle(c.x - 16, c.y - 4, c.x + 16, c.y - 4, c.x, c.y - 120);
      g.fillStyle(0xffd34d, 0.22 + 0.12 * pulse).fillEllipse(c.x, c.y, 60, 22);
      for (let k = 0; k < 4; k++) {
        const a = nowMs / 400 + (k * Math.PI) / 2;
        g.fillStyle(0xfff4c0, 0.9).fillRect(Math.round(c.x + Math.cos(a) * 22) - 1, Math.round(c.y - 24 + Math.sin(a) * 10) - 1, 2, 2);
      }
      if ((player.x - c.x) ** 2 + (player.y - c.y) ** 2 <= chestData.radius ** 2 && !picked) {
        picked = { x: c.x, y: c.y };
        c.sprite.destroy();
        this.list.splice(i, 1);
      }
    }
    return picked;
  }

  destroy(): void {
    for (const c of this.list) c.sprite.destroy();
    this.list = [];
  }
}

/** 금테 나무 상자(뚜껑 둥근) 도트, 그림 파일 없이 한 번 만듦. 열린 뚜껑은 HUD가 따로 그림 */
export function ensureChestTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CHEST_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x1a0e06, 1).fillRect(0, 7, 26, 15).fillRoundedRect(0, 0, 26, 12, 5);
  g.fillStyle(0x8a4e22, 1).fillRect(1, 9, 24, 12);
  g.fillStyle(0xa85e2a, 1).fillRoundedRect(1, 1, 24, 10, 4);
  g.fillStyle(0xffd34d, 1).fillRect(1, 9, 24, 2).fillRect(5, 1, 2, 20).fillRect(19, 1, 2, 20).fillRect(1, 19, 24, 2);
  g.fillStyle(0xfff4c0, 1).fillRect(11, 8, 4, 5);
  g.fillStyle(0x6a3a14, 1).fillRect(12, 10, 2, 2);
  g.generateTexture(CHEST_KEY, 26, 22);
  g.destroy();
}
