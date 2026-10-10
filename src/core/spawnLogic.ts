// 스폰 계산(순수 함수). 시간 기반: 초당 스폰 수를 누적해 정수가 될 때마다 내보낸다.

/** perSec 속도로 dtMs 동안 누적. 정수 부분만큼 스폰하고 나머지는 다음 프레임으로 */
export function accumulate(acc: number, perSec: number, dtMs: number): { count: number; acc: number } {
  const total = acc + (Math.max(0, perSec) * dtMs) / 1000;
  const count = Math.floor(total);
  return { count, acc: total - count };
}

/** 화면 대각선 반지름 + 여유: 화면 밖 원형 스폰 거리 */
export function spawnRadius(viewW: number, viewH: number, margin: number): number {
  return Math.hypot(viewW / 2, viewH / 2) + margin;
}

export function ringPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}
