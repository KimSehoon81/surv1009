import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { chunkMask, type FloorParams } from '../core/floorLayout';
import { Depth } from '../config/depth';

export interface FloorConfig extends FloorParams {
  base: string;
  patch: string;
  /** 가장자리 마스크 세분 */
  sub: number;
  /** [경계, 안쪽] 불투명도 */
  alpha: readonly number[];
}

interface Chunk {
  image: Phaser.GameObjects.Image;
  texture: Phaser.Textures.CanvasTexture;
}

let textureSeq = 0;

/**
 * 무한 바닥: 보이는 청크마다 캔버스 하나에 base 타일을 깔고 patch 타일을 마스크(불규칙한 가장자리 + 반투명 경계)로
 * 얹어 구운 뒤 이미지 한 장으로 그린다. 바닥 전체가 한 겹이라 화면 채우기 비용이 타일 한 장 깔 때와 같다
 * (바탕 TileSprite + 반투명 패치 레이어 두 겹으로 그리면 저사양에서 FPS가 떨어짐: 측정 60→47).
 * 화면 밖으로 나간 청크의 캔버스는 풀에 돌려 다음 청크에 다시 그린다(텍스처를 새로 만들지 않음).
 */
export class Floor {
  private readonly baseSource: CanvasImageSource;
  private readonly patchSource: CanvasImageSource;
  private readonly chunkPx: number;
  private readonly active = new Map<string, Chunk>();
  private readonly pool: Chunk[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: FloorConfig,
    private readonly seed: string,
  ) {
    this.baseSource = scene.textures.get(manifest.tile(cfg.base).key).getSourceImage() as CanvasImageSource;
    this.patchSource = scene.textures.get(manifest.tile(cfg.patch).key).getSourceImage() as CanvasImageSource;
    this.chunkPx = cfg.cell * cfg.chunkCells;
  }

  update(cam: Phaser.Cameras.Scene2D.Camera): void {
    const x0 = Math.floor(cam.scrollX / this.chunkPx);
    const y0 = Math.floor(cam.scrollY / this.chunkPx);
    const x1 = Math.floor((cam.scrollX + cam.width - 1) / this.chunkPx);
    const y1 = Math.floor((cam.scrollY + cam.height - 1) / this.chunkPx);
    const want = new Set<string>();
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = `${cx},${cy}`;
        want.add(key);
        if (!this.active.has(key)) this.active.set(key, this.build(cx, cy));
      }
    }
    for (const [key, chunk] of this.active) {
      if (want.has(key)) continue;
      chunk.image.setVisible(false);
      this.pool.push(chunk);
      this.active.delete(key);
    }
  }

  /** 디버그 표시용 */
  get stats(): { chunks: number; pooled: number } {
    return { chunks: this.active.size, pooled: this.pool.length };
  }

  private build(cx: number, cy: number): Chunk {
    const size = this.chunkPx;
    const chunk = this.pool.pop() ?? this.createChunk(size);
    const ctx = chunk.texture.getContext();
    // 청크 크기가 타일 크기의 배수라 패턴 원점(캔버스 0,0)이 월드 무늬와 자동으로 맞는다
    const basePattern = ctx.createPattern(this.baseSource, 'repeat');
    ctx.globalAlpha = 1;
    ctx.fillStyle = basePattern ?? '#6b5a3e';
    ctx.fillRect(0, 0, size, size);
    const pattern = ctx.createPattern(this.patchSource, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      const sub = this.cfg.sub;
      const step = this.cfg.cell / sub;
      const n = this.cfg.chunkCells * sub;
      const mask = chunkMask(cx, cy, this.seed, this.cfg, sub);
      for (const level of [1, 2] as const) {
        ctx.globalAlpha = this.cfg.alpha[level - 1] ?? 1;
        ctx.beginPath();
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) if (mask[j * n + i] === level) ctx.rect(i * step, j * step, step, step);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    chunk.texture.refresh();
    chunk.image.setPosition(cx * size, cy * size).setVisible(true);
    return chunk;
  }

  private createChunk(size: number): Chunk {
    const key = `floor_chunk_${textureSeq++}`;
    const texture = this.scene.textures.createCanvas(key, size, size);
    if (!texture) throw new Error('바닥 청크 텍스처 생성 실패');
    const image = this.scene.add.image(0, 0, key).setOrigin(0).setDepth(Depth.Floor);
    return { image, texture };
  }
}
