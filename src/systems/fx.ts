import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import { Depth } from '../config/depth';

const DEFAULT_FPS = 16;

/** 한 번 재생하고 사라지는 이펙트 시트(폭발·스파크 등). 스프라이트는 풀에서 재사용, 동시 개수 상한 */
export class FxSystem {
  private readonly pool: Pool<Phaser.GameObjects.Sprite>;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cap = Infinity,
  ) {
    this.pool = new Pool(() => scene.add.sprite(0, 0, '__DEFAULT').setActive(false).setVisible(false), 24);
  }

  private animKey(name: string, fps: number): string {
    const spec = manifest.fx(name);
    const key = `${spec.key}_play${fps}`;
    if (!this.scene.anims.exists(key)) {
      this.scene.anims.create({
        key,
        frames: this.scene.anims.generateFrameNumbers(spec.key, { start: 0, end: spec.frames - 1 }),
        frameRate: fps,
        repeat: 0,
      });
    }
    return key;
  }

  /**
   * 시트의 각 프레임에서 [x, y, w, h] 영역만 잘라 새 애니메이션을 만든다
   * (예: 총구 섬광 그림에 함께 그려진 총열을 빼고 섬광만 쓰기).
   */
  cropAnim(name: string, crop: readonly number[], fps: number): string {
    const spec = manifest.fx(name);
    const tag = crop.join('_');
    const key = `${spec.key}_crop${tag}_${fps}`;
    if (this.scene.anims.exists(key)) return key;
    const tex = this.scene.textures.get(spec.key);
    const [cx = 0, cy = 0, cw = spec.frameSize, ch = spec.frameSize] = crop;
    const frames: Phaser.Types.Animations.AnimationFrame[] = [];
    for (let i = 0; i < spec.frames; i++) {
      const name = `crop${tag}_${i}`;
      const src = tex.get(i);
      if (!tex.has(name)) tex.add(name, src.sourceIndex, src.cutX + cx, src.cutY + cy, cw, ch);
      frames.push({ key: spec.key, frame: name });
    }
    this.scene.anims.create({ key, frames, frameRate: fps, repeat: 0 });
    return key;
  }

  play(name: string, x: number, y: number, scale = 1, depth: number = Depth.Explosion, fps = DEFAULT_FPS, capped = false): Phaser.GameObjects.Sprite | null {
    return this.playAnim(this.animKey(name, fps), x, y, scale, depth, capped);
  }

  /**
   * capped=true(타격 장식 스파크 등)는 동시 상한에 닿으면 생략하고 null.
   * 무기 폭발·총구 섬광처럼 빠지면 안 되는 이펙트는 capped=false로 항상 재생한다.
   */
  playAnim(key: string, x: number, y: number, scale = 1, depth: number = Depth.Explosion, capped = false): Phaser.GameObjects.Sprite | null {
    if (capped && this.pool.size >= this.cap) return null;
    const s = this.pool.acquire();
    s.setPosition(x, y).setScale(scale).setDepth(depth).setOrigin(0.5).setFlipX(false).setActive(true).setVisible(true);
    s.play(key);
    s.once('animationcomplete', () => {
      s.setActive(false).setVisible(false);
      this.pool.release(s);
    });
    return s;
  }

  /** 전투 시계 배율을 이펙트 재생 속도에 반영(일시정지·히트스톱이면 멈춤) */
  update(timeScale: number): void {
    for (const s of this.pool.active) s.anims.timeScale = timeScale;
  }

  get active(): number {
    return this.pool.size;
  }
}
