import type * as Phaser from 'phaser';
import cardUi from '../data/cardUi.json';
import { manifest } from '../assets/manifest';
import type { CardDef } from '../core/cards';

// 카드 앞면 텍스처. 원본 크기(120×168)로 프레임(테두리·등급 색)·큰 일러스트·병과 배지·등급 별을 합성한 뒤
// 손패 크기(×0.5)로 부드럽게 줄여 둔다. 화면이 960×540을 2배로 키워 보여 주므로 0.5배로 바로 그리면
// 최근접 축소로 픽셀이 반씩 빠져 지저분해진다(미리 평균 내 줄이는 편이 일러스트가 또렷함).

const FRAME_BY_GRADE: Record<string, string> = {
  common: 'frame_common',
  rare: 'frame_rare',
  legendary: 'frame_legend',
  minus: 'frame_minus',
};
const STARS_BY_GRADE: Record<string, number> = { common: 1, rare: 2, legendary: 3 };

export const CARD_W = manifest.spec.card.width;
export const CARD_H = manifest.spec.card.height;
export const FACE_W = Math.round(CARD_W * cardUi.scale);
export const FACE_H = Math.round(CARD_H * cardUi.scale);
/** 손패 크기 카드에서 일러스트 영역(카드 왼쪽 위 기준): 흐린 카드·노이즈·포연 덧칠이 이 칸만 덮음 */
export const ART_RECT = {
  x: Math.round(cardUi.face.inner.x * cardUi.scale),
  y: Math.round(cardUi.face.inner.y * cardUi.scale),
  w: Math.round(cardUi.face.inner.w * cardUi.scale),
  h: Math.round(cardUi.face.inner.h * cardUi.scale),
};

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, ro: number, ri: number): void {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? ro : ri;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

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
  const f = cardUi.face;
  const frame = source(scene, manifest.card(FRAME_BY_GRADE[def.grade] ?? 'frame_common').key);
  if (frame) ctx.drawImage(frame, 0, 0, CARD_W, CARD_H);
  // 프레임의 이름 띠·설명 칸(손패에서 늘 빈 황색 띠)을 덮고 그 자리까지 일러스트를 크게
  const r = f.inner;
  ctx.fillStyle = '#181612';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  const art = source(scene, manifest.card(id).key);
  if (art) {
    const { w, h } = sizeOf(art);
    // 칸 비율에 맞게 가운데 기준으로 양옆을 살짝 잘라 꽉 채움
    const cw = Math.min(w, Math.round((h * r.w) / r.h));
    ctx.drawImage(art, Math.round((w - cw) / 2), 0, cw, h, r.x, r.y, r.w, r.h);
  }
  ctx.strokeStyle = '#0a0806';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  // 병과 배지(조합 판단용): 어두운 원 + 밝은 테두리 + 아이콘. 마이너스는 붉은 경고
  const b = f.badge;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fillStyle = def.tag === 'minus' ? 'rgba(90,16,12,0.95)' : 'rgba(20,18,14,0.92)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = def.tag === 'minus' ? '#ff6050' : '#e6d296';
  ctx.stroke();
  if (def.tag !== 'minus') {
    const tag = source(scene, manifest.image('ui', `tag_${def.tag}`, 32, 32).key);
    if (tag) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tag, b.x - b.icon / 2, b.y - b.icon / 2, b.icon, b.icon);
      ctx.imageSmoothingEnabled = false;
    }
  } else {
    ctx.fillStyle = '#ffd0c0';
    ctx.fillRect(b.x - 2, b.y - 9, 4, 11);
    ctx.fillRect(b.x - 2, b.y + 5, 4, 4);
  }
  // 등급: 점 대신 큰 별(일반 1·희귀 2·전설 3), 빈 자리는 어두운 작은 별
  const n = STARS_BY_GRADE[def.grade] ?? 0;
  const s = f.stars;
  s.xs.forEach((x, i) => {
    const on = i < n;
    star(ctx, x, s.y, on ? s.r : s.rEmpty, on ? s.ri : s.ri - 1);
    ctx.fillStyle = on ? cardUi.colors.success : '#2a2620';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = on ? '#4a3000' : '#5a5040';
    ctx.stroke();
  });
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
