import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import { Depth } from '../config/depth';

/** 한 번 재생하고 사라지는 이펙트 시트(폭발·스파크 등). 스프라이트는 풀에서 재사용 */
export class FxSystem {
  private readonly pool: Pool<Phaser.GameObjects.Sprite>;
  private readonly fps = 16;

  constructor(private readonly scene: Phaser.Scene) {
    this.pool = new Pool(() => scene.add.sprite(0, 0, '__DEFAULT').setActive(false).setVisible(false), 24);
  }

  private animKey(name: string): string {
    const spec = manifest.fx(name);
    const key = `${spec.key}_play`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers(spec.key, { start: 0, end: spec.frames - 1 }),
        frameRate: this.fps,
        repeat: 0,
      });
    }
    return key;
  }

  play(name: string, x: number, y: number, scale = 1, depth: number = Depth.Explosion): void {
    const s = this.pool.acquire();
    s.setPosition(x, y).setScale(scale).setDepth(depth).setActive(true).setVisible(true);
    s.play(this.animKey(name));
    s.once('animationcomplete', () => {
      s.setActive(false).setVisible(false);
      this.pool.release(s);
    });
  }

  /** 전투 시계 배율을 이펙트 재생 속도에 반영(일시정지·히트스톱이면 멈춤) */
  update(timeScale: number): void {
    for (const s of this.pool.active) s.anims.timeScale = timeScale;
  }

  get active(): number {
    return this.pool.size;
  }
}
