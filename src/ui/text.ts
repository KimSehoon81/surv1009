import type * as Phaser from 'phaser';

/**
 * 화면 글꼴: 갈무리(Galmuri, OFL, public/fonts). 본문 Galmuri11, 큰 글씨(18px 이상) Galmuri14. 못 읽으면 monospace.
 * 글자 텍스처 해상도는 화면 정수 배율에 맞춘다: 2배로 그린 글자를 도트 필터(최근접)로 1배 화면에 줄이면 획이 빠져 깨진다.
 */
export const FONT_BODY = 'Galmuri11, monospace';
export const FONT_TITLE = 'Galmuri14, Galmuri11, monospace';
export const fontFor = (size: number): string => (size >= 18 ? FONT_TITLE : FONT_BODY);

let res = 1;
/** 화면 배율이 바뀔 때(main.ts). 바뀌었으면 true */
export function setTextResolution(zoom: number): boolean {
  const next = Math.max(1, Math.ceil(zoom - 0.01));
  const changed = next !== res;
  res = next;
  return changed;
}
export const textResolution = (): number => res;

/** 메뉴·지도·HUD 공용 글자 스타일 */
export const uiText = (size: number, color = '#e8dcc0'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: fontFor(size),
  fontSize: `${size}px`,
  color,
  resolution: res,
});
