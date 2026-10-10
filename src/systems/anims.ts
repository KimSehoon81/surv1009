import type * as Phaser from 'phaser';
import type { SheetSpec } from '../assets/manifest';

/** 시트 하나를 프레임 0..n-1 애니메이션으로 등록(이미 있으면 재사용). 키는 시트 키와 같다 */
export function ensureSheetAnim(scene: Phaser.Scene, sheet: SheetSpec, frameRate = 10, repeat = -1): string {
  if (!scene.anims.exists(sheet.key)) {
    scene.anims.create({
      key: sheet.key,
      frames: scene.anims.generateFrameNumbers(sheet.key, { start: 0, end: sheet.frames - 1 }),
      frameRate,
      repeat,
    });
  }
  return sheet.key;
}
