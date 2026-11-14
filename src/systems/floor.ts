import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { chunkMask, type FloorParams } from '../core/floorLayout';
import { Depth } from '../config/depth';
import terrainData from '../data/terrain.json';
import { hashString } from '../core/rng';
import { chunkSpots, streamAt, streamsNear, type TerrainCfg } from '../core/terrain';

type Palette = (typeof terrainData.palettes)['summer'];

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

  private readonly numSeed: number;
  private readonly pal: Palette | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: FloorConfig,
    private readonly seed: string,
    /** 개울·풀숲·눈 더미·낙엽(terrain.json), 없으면 타일만 */
    private readonly terrain?: TerrainCfg,
  ) {
    this.numSeed = hashString(seed);
    this.pal = terrain ? (terrainData.palettes as Record<string, Palette>)[terrain.season] : undefined;
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

  /** 씬 종료 시 청크 캔버스 텍스처 해제(텍스처는 게임 전역이라 씬 재시작마다 쌓이지 않게) */
  destroy(): void {
    for (const c of [...this.active.values(), ...this.pool]) {
      c.image.destroy();
      c.texture.destroy();
    }
    this.active.clear();
    this.pool.length = 0;
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
    this.drawFeatures(ctx, cx, cy, size);
    chunk.texture.refresh();
    chunk.image.setPosition(cx * size, cy * size).setVisible(true);
    return chunk;
  }

  /** 개울(월드 곡선이라 청크 경계에서 이어짐)·눈 더미·풀숲·낙엽을 2px 도트로 */
  private drawFeatures(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
    const t = this.terrain;
    const pal = this.pal;
    if (!t || !pal) return;
    const box = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    };
    const s = t.streams;
    if (s) {
      const v = s.dir === 'v';
      const along0 = v ? cy * size : cx * size;
      const across0 = v ? cx * size : cy * size;
      const ks = streamsNear(s, across0, across0 + size);
      // 가로지르는 띠: v면 x축으로, 아니면 y축으로
      const band = (i: number, a: number, len: number, c: string) => (v ? box(a, i, len, 2, c) : box(i, a, 2, len, c));
      for (let i = 0; i < size; i += 2) {
        for (const k of ks) {
          const { center, half } = streamAt(s, this.numSeed, k, along0 + i);
          const c = center - across0;
          if (c + half + 6 < 0 || c - half - 6 > size) continue;
          band(i, c - half - 5, half * 2 + 10, s.frozen ? pal.snowShade : pal.bank);
          band(i, c - half - 2, half * 2 + 4, s.frozen ? pal.iceEdge : pal.bankDark);
          band(i, c - half, half * 2, s.frozen ? pal.ice : pal.water);
          // 물결(얼음 금): 드문드문 밝은 짧은 줄
          const h = (Math.floor((along0 + i) / 2) * 7 + k * 13 + 1000) % 23;
          if (h < 3) band(i, c - half / 2 + h * (half / 2), 2, s.frozen ? pal.iceCrack : pal.ripple);
        }
      }
    }
    const spots = chunkSpots(t, this.numSeed, cx, cy, size);
    for (const p of spots.snow) {
      // 눈 더미: 납작한 타원을 2px 줄로, 아래 두 줄은 그늘, 반짝이 몇 점
      const rx = 10 + p.size * 26;
      const ry = rx * 0.32;
      for (let dy = -ry; dy <= ry; dy += 2) {
        const w = rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2)) * (0.75 + 0.25 * Math.sin(dy * 1.3 + p.v * 9));
        const lump = Math.round(4 * Math.sin(dy * 0.9 + p.v * 5));
        box(p.x - w + lump, p.y + dy, w * 2, 2, dy > ry - 4 ? pal.snowShade : pal.snow);
      }
      for (let k = 0; k < 3; k++) box(p.x - rx / 2 + ((p.v * 97 + k * 31) % rx), p.y - ry / 3 + k * 2, 1, 1, '#ffffff');
    }
    for (const p of spots.grass) {
      // 풀숲: 짧은 풀잎 여러 개(색 3단), 여름엔 들꽃 몇 송이
      const n = 9 + Math.floor(p.size * 12);
      const r = 8 + p.size * 16;
      let q = Math.floor(p.v * 1e6);
      const rnd = () => ((q = (q * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let j = 0; j < n; j++) {
        const x = p.x + (rnd() - 0.5) * 2 * r;
        const y = p.y + (rnd() - 0.5) * r;
        const h = 4 + Math.floor(rnd() * 5);
        // 2px 풀잎(바닥 타일 도트 크기에 맞춤), 끝은 한 칸 옆으로 휨
        box(x, y - h, 2, h, pal.grass[j % pal.grass.length] ?? '#5a8a34');
        box(x + (rnd() < 0.5 ? -1 : 2), y - h - 2, 1, 2, pal.grass[(j + 1) % pal.grass.length] ?? '#7aa844');
      }
      if (pal.flowers.length > 0 && p.v > 0.55) for (let j = 0; j < 3; j++) box(p.x + (rnd() - 0.5) * r * 1.6, p.y + (rnd() - 0.5) * r * 0.8 - 3, 2, 2, pal.flowers[j % pal.flowers.length] ?? '#ffffff');
    }
    for (const p of spots.leaves) {
      let q = Math.floor(p.v * 1e6) + 7;
      const rnd = () => ((q = (q * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let j = 0; j < 5 + Math.floor(p.size * 6); j++) box(p.x + (rnd() - 0.5) * 30, p.y + (rnd() - 0.5) * 16, 2, 1, pal.leaves[j % Math.max(1, pal.leaves.length)] ?? '#8a5a2a');
    }
  }

  private createChunk(size: number): Chunk {
    const key = `floor_chunk_${textureSeq++}`;
    const texture = this.scene.textures.createCanvas(key, size, size);
    if (!texture) throw new Error('floor chunk texture failed');
    const image = this.scene.add.image(0, 0, key).setOrigin(0).setDepth(Depth.Floor);
    return { image, texture };
  }
}
