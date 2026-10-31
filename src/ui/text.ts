import type * as Phaser from 'phaser';

/** 메뉴·지도 공용 글자 스타일(한글은 시스템 글꼴, 2배 해상도) */
export const uiText = (size: number, color = '#e8dcc0'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: 'monospace',
  fontSize: `${size}px`,
  color,
  resolution: 2,
});
