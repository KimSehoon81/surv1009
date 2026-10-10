// 자리표시자 텍스처. 실제 PNG와 같은 키·크기·프레임 구조로 만들어 교체가 코드 수정 없이 되게 한다.
// 몸체는 ASSETS.md 2장 규격(100×100 프레임, 몸체 높이 ~62px, 발 기준점 50,92)을 그대로 따라
// 자리표시자 단계에서도 화면 비율·정렬을 실제 그림과 같게 확인할 수 있다.

import type * as Phaser from 'phaser';
import type { Faction, ImageSpec, SheetSpec } from '../assets/manifest';

const OUTLINE = '#2a1a10'; // PRD §10: 짙은 갈색 외곽선

const FACTION_COLOR: Record<Faction, { body: string; dark: string; light: string }> = {
  ally: { body: '#2fae9c', dark: '#1d6f64', light: '#8fe3d6' }, // 아군 청록
  enemy: { body: '#c4473b', dark: '#7c2a22', light: '#f0958a' }, // 적 붉은색
  npc: { body: '#d6ae45', dark: '#8a6c22', light: '#f3dc96' }, // 중립 황색
};

type Ctx = CanvasRenderingContext2D;

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string, outline = true): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (outline) {
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
  }
  ctx.fillStyle = fill;
  ctx.fillRect(rx, ry, rw, rh);
}

function label(ctx: Ctx, text: string, x: number, y: number, size: number, color = '#ffffff', align: CanvasTextAlign = 'left'): void {
  ctx.font = `bold ${size}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle = OUTLINE;
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * 한 프레임(100×100 기준 좌표)을 그린다. s는 대형(200) 프레임 배율.
 * 동작별로 구분되는 표식을 넣어 애니메이션 전환이 눈에 보이게 한다.
 */
function drawUnitFrame(ctx: Ctx, ox: number, oy: number, s: number, sheet: SheetSpec, frame: number): void {
  const c = FACTION_COLOR[sheet.faction];
  const t = frame / sheet.frames; // 0~0.9
  const wave = Math.sin(t * Math.PI * 2);
  const P = (v: number) => v * s;
  const facing = 1; // 오른쪽을 본다(왼쪽은 코드가 반전)

  // 바닥 그림자와 발 기준점(50,92)
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(ox + P(36), oy + P(91), P(28), P(3));

  let bob = Math.round(wave * 1.5);
  let lean = 0;
  let flash = false;
  switch (sheet.action) {
    case 'move_fast':
      bob = Math.round(wave * 3);
      lean = 4;
      break;
    case 'hit':
      lean = -3;
      flash = frame % 2 === 0;
      break;
    case 'crit':
      lean = frame < 4 ? -2 : 5;
      break;
    case 'idle':
    case 'talk':
    case 'give':
      bob = Math.round(wave);
      break;
  }

  const bodyX = 50 - 15 + lean;
  const bodyTop = 46 + bob;
  const bodyColor = flash ? '#ffffff' : c.body;

  // 다리(발이 y=92에 닿게)
  const step = sheet.action.startsWith('move') ? Math.round(wave * 3) : 0;
  rect(ctx, ox + P(40 + step), oy + P(78), P(7), P(14), c.dark);
  rect(ctx, ox + P(53 - step), oy + P(78), P(7), P(14), c.dark);
  // 몸통·머리 (머리 꼭대기 y≈30 → 몸체 높이 약 62px)
  rect(ctx, ox + P(bodyX), oy + P(bodyTop), P(30), P(33), bodyColor);
  rect(ctx, ox + P(50 - 9 + lean), oy + P(bodyTop - 16), P(18), P(15), flash ? '#ffffff' : c.light);
  // 눈(바라보는 방향 표시)
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(ox + P(50 + 3 * facing + lean), oy + P(bodyTop - 11), Math.max(1, P(2)), Math.max(1, P(3)));

  // 동작 표식
  const handX = 50 + 15 + lean;
  const handY = bodyTop + 12;
  switch (sheet.action) {
    case 'attack':
      rect(ctx, ox + P(handX), oy + P(handY), P(18), P(4), '#555049');
      if (frame % 3 === 0) rect(ctx, ox + P(handX + 18), oy + P(handY - 3), P(8), P(10), '#ffd34d', false);
      break;
    case 'defend':
      rect(ctx, ox + P(handX - 2), oy + P(bodyTop - 4), P(8), P(36), '#8a8f96');
      break;
    case 'skill':
      rect(ctx, ox + P(handX - 6), oy + P(bodyTop - 22 - Math.abs(bob) * 2), P(5), P(20), c.light);
      if (frame >= 4) rect(ctx, ox + P(handX - 9), oy + P(bodyTop - 30), P(11), P(6), '#7ff0ff', false);
      break;
    case 'crit':
      rect(ctx, ox + P(handX), oy + P(handY - 4), P(22), P(6), '#555049');
      if (frame >= 4 && frame <= 6) rect(ctx, ox + P(handX + 22), oy + P(handY - 9), P(14), P(16), '#ffe14d', false);
      break;
    case 'move_fast':
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 3; i++) ctx.fillRect(ox + P(10 + i * 4), oy + P(52 + i * 10), P(14), Math.max(1, P(2)));
      break;
    case 'talk':
      if (frame % 4 < 2) rect(ctx, ox + P(68), oy + P(18), P(20), P(12), '#ffffff');
      break;
    case 'give':
      rect(ctx, ox + P(handX), oy + P(handY + 2 - Math.round(t * 6)), P(10), P(10), '#c9a36b');
      break;
  }

  // 식별 문구: ID(좌상단), 동작(하단), 프레임 번호(우상단)
  label(ctx, sheet.id, ox + P(3), oy + P(2), Math.round(11 * s), '#ffffff');
  label(ctx, String(frame), ox + P(97), oy + P(2), Math.round(10 * s), '#ffe14d', 'right');
  label(ctx, sheet.action, ox + P(50), oy + P(94) - 1, Math.round(7 * s), '#d8d0c4', 'center');
}

/** 4×4 격자 시트(앞 frames칸 사용)를 캔버스 텍스처로 만들고 프레임 0..n-1을 등록한다 */
export function createSheetPlaceholder(scene: Phaser.Scene, sheet: SheetSpec): void {
  const fs = sheet.frameSize;
  const tex = scene.textures.createCanvas(sheet.key, fs * sheet.cols, fs * sheet.rows);
  if (!tex) throw new Error(`placeholder: 텍스처 생성 실패 ${sheet.key}`);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const s = fs / 100;
  for (let i = 0; i < sheet.frames; i++) {
    const x = (i % sheet.cols) * fs;
    const y = Math.floor(i / sheet.cols) * fs;
    drawUnitFrame(ctx, x, y, s, sheet, i);
    tex.add(i, 0, x, y, fs, fs);
  }
  tex.refresh();
}

/** 타일(체크 무늬)·카드(프레임+일러스트 칸)·기타(테두리 상자) 자리표시자 */
export function createImagePlaceholder(scene: Phaser.Scene, image: ImageSpec): void {
  const { width: w, height: h } = image;
  const tex = scene.textures.createCanvas(image.key, w, h);
  if (!tex) throw new Error(`placeholder: 텍스처 생성 실패 ${image.key}`);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;

  if (image.category === 'tile') {
    // 이음매 없이 반복되도록 타일 크기의 약수(16px) 격자
    const hue = (Number(image.label.replace(/\D/g, '')) * 37) % 360;
    for (let y = 0; y < h; y += 16) {
      for (let x = 0; x < w; x += 16) {
        const even = (x / 16 + y / 16) % 2 === 0;
        ctx.fillStyle = `hsl(${hue} 22% ${even ? 24 : 21}%)`;
        ctx.fillRect(x, y, 16, 16);
      }
    }
    label(ctx, image.label, 3, 3, 8, 'rgba(255,255,255,0.18)');
  } else if (image.category === 'card') {
    rect(ctx, 1, 1, w - 2, h - 2, '#e9dcc0');
    rect(ctx, 8, 22, w - 16, 104, '#9c8a6a'); // 일러스트 칸 104×104 (tools/art 규격)
    label(ctx, image.label, w / 2, 6, 12, '#3a2a1a', 'center');
    label(ctx, '?', w / 2, 58, 28, '#e9dcc0', 'center');
  } else {
    ctx.strokeStyle = '#ff4fd8';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    label(ctx, image.label, 4, 4, 10, '#ff4fd8');
  }
  tex.refresh();
}
