// 이동 계산(순수 함수). 대각선 이동이 빨라지지 않도록 입력 방향을 정규화한다.

export interface Vec2 {
  x: number;
  y: number;
}

/** 키 입력 축(-1/0/1)을 길이 1 이하의 방향으로 */
export function normalizeAxis(x: number, y: number): Vec2 {
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  const k = len > 1 ? 1 / len : 1;
  return { x: x * k, y: y * k };
}

/** dtMs 동안 speed(px/초)로 이동한 새 위치 */
export function step(pos: Vec2, dir: Vec2, speed: number, dtMs: number): Vec2 {
  const d = (speed * dtMs) / 1000;
  return { x: pos.x + dir.x * d, y: pos.y + dir.y * d };
}

/** 좌우 바라보는 방향: 가로 입력이 없으면 이전 방향 유지 */
export function facingFrom(dirX: number, prev: 1 | -1): 1 | -1 {
  if (dirX > 0) return 1;
  if (dirX < 0) return -1;
  return prev;
}
