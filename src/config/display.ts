// 화면 규격. 논리 해상도는 고정, 창 크기에 맞춰 배율만 바꾼다.

export const LOGICAL_WIDTH = 960;
export const LOGICAL_HEIGHT = 540;

/**
 * 창 크기에 맞는 화면 배율.
 * 1배 이상 들어가면 정수 배율(도트가 고르게 보임, 1920×1080 → 2배),
 * 960×540보다 작은 창에서만 비정수로 줄인다(잘리는 것보다 낫다).
 */
export function computeZoom(viewWidth: number, viewHeight: number): number {
  const fit = Math.min(viewWidth / LOGICAL_WIDTH, viewHeight / LOGICAL_HEIGHT);
  if (!Number.isFinite(fit) || fit <= 0) return 1;
  if (fit >= 1) return Math.floor(fit);
  // 너무 작게 줄어 읽을 수 없게 되는 것만 막는다
  return Math.max(0.25, Math.floor(fit * 100) / 100);
}
