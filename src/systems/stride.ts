// 이동 시트 → 걸음 텍스처(core/stride). 처음 쓰는 순간 한 번 캔버스로 만들어 같은 키로 재사용
import type * as Phaser from 'phaser';
import animations from '../data/animations.json';
import type { SheetSpec } from '../assets/manifest';
import { STRIDE_CYCLE, strideFrame, type StrideConfig } from '../core/stride';

const CFG = animations.stride as unknown as StrideConfig & { cycles: number; actions: string[]; fps: Record<string, number>; exclude: string[] };

/** 이 시트에 걸음 합성을 쓸지: 실제 그림 파일이 있고, 대형이 아니고, 제외 목록에 없는 이동 동작 */
export function wantsStride(sheet: SheetSpec): boolean {
  return sheet.path !== null && !sheet.large && CFG.actions.includes(sheet.action) && !CFG.exclude.includes(sheet.id);
}

export const strideFps = (action: string, fallback: number): number => CFG.fps[action] ?? fallback;

/** 걸음 텍스처 키와 프레임 수. 원본 텍스처를 읽을 수 없으면 null(원래 애니메이션 그대로) */
export function buildStride(scene: Phaser.Scene, sheet: SheetSpec): { key: string; frames: number } | null {
  const key = `${sheet.key}__stride`;
  const n = STRIDE_CYCLE.length * CFG.cycles;
  if (scene.textures.exists(key)) return { key, frames: n };
  const tex = scene.textures.get(sheet.key);
  if (!tex || tex.key === '__MISSING') return null;
  const fs = sheet.frameSize;
  const tmp = document.createElement('canvas');
  tmp.width = fs;
  tmp.height = fs;
  const tctx = tmp.getContext('2d', { willReadFrequently: true });
  const out = scene.textures.createCanvas(key, fs * n, fs);
  const octx = out?.getContext();
  if (!tctx || !out || !octx) return null;
  for (let k = 0; k < n; k++) {
    const frame = tex.get(k % sheet.frames);
    tctx.clearRect(0, 0, fs, fs);
    tctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, frame.cutWidth, frame.cutHeight);
    const img = tctx.getImageData(0, 0, fs, fs);
    const p = strideFrame({ data: img.data, w: fs, h: fs }, STRIDE_CYCLE[k % STRIDE_CYCLE.length] ?? 'orig', CFG);
    octx.putImageData(new ImageData(new Uint8ClampedArray(p.data), fs, fs), k * fs, 0);
    out.add(k, 0, k * fs, 0, fs, fs);
  }
  out.refresh();
  return { key, frames: n };
}
