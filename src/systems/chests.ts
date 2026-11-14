// 보물 상자(월드): 엘리트가 쓰러진 자리에 금테 상자 + 빛기둥·반짝임. 닿으면 전투가 HUD 상자 열기 연출을 띄움
import * as Phaser from 'phaser';
import chestData from '../data/chest.json';
import { Depth } from '../config/depth';
import { manifest } from '../assets/manifest';

/** 그림(sprites/treasure_chest.png 등, tools/art P5)이 있으면 그것을 원래 크기로, 없으면 코드 도트를 배율로 */
const art = (scene: Phaser.Scene, name: string): string | null => {
  const key = manifest.sprite(name).key;
  return scene.textures.exists(key) ? key : null;
};

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
    const pic = art(this.scene, 'treasure_chest');
    const sprite = this.scene.add.image(x, y, pic ?? CHEST_KEY).setOrigin(0.5, 1).setDepth(Depth.Decal + 4).setScale(0);
    this.scene.tweens.add({ targets: sprite, scale: pic ? 1 : chestData.scale, duration: 260, ease: 'Back.out' });
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

export const MAGNET_KEY = 'magnet_item';

/** 자석(뱀서의 진공청소기): 일반 적이 드물게 떨어뜨림, 주우면 전장의 경험치 별을 모두 끌어옴 */
export class MagnetDrops {
  private list: { x: number; y: number; bornMs: number; sprite: Phaser.GameObjects.Image }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    ensureMagnetTexture(scene);
  }

  spawn(x: number, y: number, nowMs: number): void {
    const pic = art(this.scene, 'magnet_item');
    const sprite = this.scene.add.image(x, y, pic ?? MAGNET_KEY).setOrigin(0.5, 1).setDepth(Depth.Decal + 4).setScale(pic ? 1 : 1.6);
    this.scene.tweens.add({ targets: sprite, y: y - 6, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.list.push({ x, y, bornMs: nowMs, sprite });
  }

  /** 닿았으면 true(그 자석은 없앰) */
  update(nowMs: number, player: { x: number; y: number }): boolean {
    let got = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      if (!m) continue;
      const left = chestData.magnetLifeMs - (nowMs - m.bornMs);
      if (left <= 0) {
        m.sprite.destroy();
        this.list.splice(i, 1);
        continue;
      }
      m.sprite.setVisible(left > 5000 || Math.floor(nowMs / 150) % 2 === 0);
      if (!got && (player.x - m.x) ** 2 + (player.y - m.y) ** 2 <= chestData.radius ** 2) {
        got = true;
        m.sprite.destroy();
        this.list.splice(i, 1);
      }
    }
    return got;
  }

  destroy(): void {
    for (const m of this.list) m.sprite.destroy();
    this.list = [];
  }
}

/** 말굽자석 도트(빨강 몸통 + 은색 끝) */
function ensureMagnetTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(MAGNET_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // 말굽(ㄇ자) 바깥 테두리 → 빨강 몸통 → 밝은 줄 → 은색 끝(다리 사이·아래는 투명)
  g.fillStyle(0x1a0806, 1).fillRect(0, 0, 18, 9).fillRect(0, 0, 8, 18).fillRect(10, 0, 8, 18);
  g.fillStyle(0xd83a2a, 1).fillRect(1, 1, 16, 7).fillRect(1, 1, 6, 16).fillRect(11, 1, 6, 16);
  g.fillStyle(0xff7a5a, 1).fillRect(2, 2, 14, 2);
  g.fillStyle(0xd8d8e0, 1).fillRect(1, 13, 6, 4).fillRect(11, 13, 6, 4);
  g.generateTexture(MAGNET_KEY, 18, 18);
  g.destroy();
}

