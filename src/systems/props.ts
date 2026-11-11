// 배경 소품(D37): 시드 청크 배치(core/props) + 스프라이트 풀. 흔들림 루프는 소품마다 어긋나고, 풀은 플레이어가 지나가면 밟힘 2프레임.
import type * as Phaser from 'phaser';
import propsData from '../data/props.json';
import { manifest } from '../assets/manifest';
import { Depth } from '../config/depth';
import { chunkProps, propFrame, type PlacedProp, type PropLayout } from '../core/props';

const CHUNK = propsData.chunkPx;
const FPS = propsData.fps as Record<string, number>;
const KEEP = 1;

interface Live {
  prop: PlacedProp;
  sprite: Phaser.GameObjects.Sprite;
}

export class PropSystem {
  private readonly chunks = new Map<string, Live[]>();
  private readonly pool: Phaser.GameObjects.Sprite[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layout: PropLayout | null,
    private readonly seed: string,
  ) {}

  get active(): number {
    let n = 0;
    for (const c of this.chunks.values()) n += c.length;
    return n;
  }

  update(cam: Phaser.Cameras.Scene2D.Camera, timeMs: number, player: { x: number; y: number }): void {
    const L = this.layout;
    if (!L) return;
    const x0 = Math.floor(cam.scrollX / CHUNK) - KEEP;
    const y0 = Math.floor(cam.scrollY / CHUNK) - KEEP;
    const x1 = Math.floor((cam.scrollX + cam.width) / CHUNK) + KEEP;
    const y1 = Math.floor((cam.scrollY + cam.height) / CHUNK) + KEEP;
    // 화면 밖 청크는 풀로 반납
    for (const [key, list] of this.chunks) {
      const [cx = 0, cy = 0] = key.split(',').map(Number);
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) {
        for (const l of list) this.pool.push(l.sprite.setVisible(false).setActive(false));
        this.chunks.delete(key);
      }
    }
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        if (this.chunks.has(key)) continue;
        // 그림 파일이 없는 소품은 놓지 않음(placeholder=false)
        const placed = chunkProps(cx, cy, CHUNK, L, this.seed).filter((p) => propsData.placeholder || manifest.prop(p.kind.sprite).path !== null);
        this.chunks.set(key, placed.map((prop) => ({ prop, sprite: this.take(prop) })));
      }
    }
    const r2 = propsData.trampleRadius ** 2;
    const [ta = 4, tb = 5] = propsData.trampleFrames;
    for (const list of this.chunks.values()) {
      for (const { prop, sprite } of list) {
        const k = prop.kind;
        // 풀 밟힘: 플레이어 반경 안이면 2프레임 번갈아
        const trampled = k.grass === true && (prop.x - player.x) ** 2 + (prop.y - player.y) ** 2 <= r2;
        const f = trampled ? (Math.floor(timeMs / 120) % 2 === 0 ? ta : tb) : propFrame(k.anim, prop.phase, timeMs, FPS[k.anim] ?? 8);
        if (sprite.frame.name !== String(f)) sprite.setFrame(f);
        sprite.setDepth((k.grass ? Depth.Decal + 1 : Depth.Unit) + (prop.y - cam.scrollY) * 0.001);
      }
    }
  }

  private take(p: PlacedProp): Phaser.GameObjects.Sprite {
    const key = manifest.prop(p.kind.sprite).key;
    const s = this.pool.pop() ?? this.scene.add.sprite(0, 0, key);
    return s
      .setTexture(key, 0)
      .setOrigin(0.5, 0.9)
      .setPosition(p.x, p.y)
      .setScale(p.kind.scale ?? 1)
      .setActive(true)
      .setVisible(true);
  }
}
