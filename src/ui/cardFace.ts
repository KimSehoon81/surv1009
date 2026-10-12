import type * as Phaser from 'phaser';
import cardUi from '../data/cardUi.json';
import { manifest } from '../assets/manifest';
import type { CardDef } from '../core/cards';

// 카드 앞면 텍스처. 원본 크기(120×168)로 프레임·일러스트·병과 아이콘·등급 원을 합성한 뒤
// 손패 크기(×0.5)로 부드럽게 줄여 둔다. 화면이 960×540을 2배로 키워 보여 주므로 0.5배로 바로 그리면
// 최근접 축소로 픽셀이 반씩 빠져 지저분해진다(미리 평균 내 줄이는 편이 일러스트가 또렷함).

const FRAME_BY_GRADE: Record<string, string> = {
  common: 'frame_common',
  rare: 'frame_rare',
  legendary: 'frame_legend',
  minus: 'frame_minus',
};
const PIPS_BY_GRADE: Record<string, number> = { common: 1, rare: 2, legendary: 3 };

export const CARD_W = manifest.spec.card.width;
export const CARD_H = manifest.spec.card.height;
export const FACE_W = Math.round(CARD_W * cardUi.scale);
export const FACE_H = Math.round(CARD_H * cardUi.scale);

function source(scene: Phaser.Scene, key: string): CanvasImageSource | null {
  if (!scene.textures.exists(key)) return null;
  return scene.textures.get(key).getSourceImage() as CanvasImageSource;
}

function sizeOf(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { width: number; height: number };
  return { w: i.width, h: i.height };
}

/** 원본 크기 캔버스를 줄여 텍스처로 등록 */
function registerScaled(scene: Phaser.Scene, key: string, full: HTMLCanvasElement): void {
  const tex = scene.textures.createCanvas(key, FACE_W, FACE_H);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, FACE_W, FACE_H);
  tex.refresh();
}

function fullCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** 카드 앞면 텍스처 키(없으면 만듦) */
export function cardFaceKey(scene: Phaser.Scene, id: string, def: CardDef): string {
  const key = `cardface_${id}`;
  if (scene.textures.exists(key)) return key;
  const { canvas, ctx } = fullCanvas();
  const frame = source(scene, manifest.card(FRAME_BY_GRADE[def.grade] ?? 'frame_common').key);
  if (frame) ctx.drawImage(frame, 0, 0, CARD_W, CARD_H);
  const art = source(scene, manifest.card(id).key);
  const a = cardUi.face.art;
  if (art) {
    const { w, h } = sizeOf(art);
    // 일러스트(104×104)를 창 크기만큼 가운데에서 잘라 1:1로
    ctx.drawImage(art, Math.max(0, (w - a.w) / 2), Math.max(0, (h - a.h) / 2), Math.min(w, a.w), Math.min(h, a.h), a.x, a.y, a.w, a.h);
  }
  if (def.tag !== 'minus') {
    const tag = source(scene, manifest.image('ui', `tag_${def.tag}`, 32, 32).key);
    const t = cardUi.face.tag;
    if (tag) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tag, t.x - t.size / 2, t.y - t.size / 2, t.size, t.size);
      ctx.imageSmoothingEnabled = false;
    }
  }
  const pips = PIPS_BY_GRADE[def.grade] ?? 0;
  const p = cardUi.face.pips;
  ctx.fillStyle = cardUi.colors.success;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(p.xs[i] ?? 0, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  registerScaled(scene, key, canvas);
  return key;
}

/** 카드 뒷면(판정 뒤집기 중간) */
export function cardBackKey(scene: Phaser.Scene): string {
  const key = 'cardface__back';
  if (scene.textures.exists(key)) return key;
  const { canvas, ctx } = fullCanvas();
  const back = source(scene, manifest.card('card_back').key);
  if (back) ctx.drawImage(back, 0, 0, CARD_W, CARD_H);
  registerScaled(scene, key, canvas);
  return key;
}

/** 오버레이(균열·성공) 줄인 텍스처 */
export function overlayKey(scene: Phaser.Scene, name: string): string {
  const key = `cardface__${name}`;
  if (scene.textures.exists(key)) return key;
  const { canvas, ctx } = fullCanvas();
  const src = source(scene, manifest.image('ui', name, CARD_W, CARD_H).key);
  if (src) ctx.drawImage(src, 0, 0, CARD_W, CARD_H);
  registerScaled(scene, key, canvas);
  return key;
}

/** 손패·판정 연출에 필요한 그림(Preload가 불러옴) */
export function cardAssetSpecs(cardIds: readonly string[], tags: readonly string[]) {
  return [
    ...Object.values(FRAME_BY_GRADE).map((n) => manifest.card(n)),
    manifest.card('card_back'),
    ...cardIds.map((id) => manifest.card(id)),
    ...tags.filter((t) => t !== 'minus').map((t) => manifest.image('ui', `tag_${t}`, 32, 32)),
    manifest.image('ui', 'overlay_crack', CARD_W, CARD_H),
    manifest.image('ui', 'overlay_success', CARD_W, CARD_H),
    manifest.image('ui', 'seal', 32, 32),
  ];
}
