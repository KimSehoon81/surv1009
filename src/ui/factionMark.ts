import type * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import { parseColor } from '../core/feel';

/**
 * 색약 대응 형태 표시(PRD §11, D42). 색(아군 청록·적 적색)과 함께 형태로도 진영을 구분한다.
 * 아군 = 원 둘레의 안쪽 눈금 4개(조준선), 적 = 마름모. 크기는 feel.json factionShape.
 */
const SHAPE = feelData.factionShape;
export const ENEMY_COLOR = parseColor(feelData.threatMarker.color);

/** 적: 중심 (x, y)에 마름모 테두리(반지름 r, 기본 factionShape.enemyPx) */
export function enemyMark(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha: number, r = SHAPE.enemyPx): void {
  g.lineStyle(SHAPE.lineWidth, color, alpha).strokePoints(
    [
      { x, y: y - r },
      { x: x + r, y },
      { x, y: y + r },
      { x: x - r, y },
    ],
    true,
  );
}

/** 아군: 반지름 r 원의 상하좌우에서 안쪽으로 짧은 눈금 */
export function allyMark(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, alpha: number): void {
  const len = Math.max(3, r * SHAPE.allyTickFrac);
  g.lineStyle(SHAPE.lineWidth, color, alpha)
    .lineBetween(x - r, y, x - r + len, y)
    .lineBetween(x + r, y, x + r - len, y)
    .lineBetween(x, y - r, x, y - r + len)
    .lineBetween(x, y + r, x, y + r - len);
}
