// 터치 조작(모바일): 가상 조이스틱 벡터, 세로로 든 화면을 가로로 돌리는 좌표 변환, 가상 버튼 → 액션. Phaser·DOM 없음
import type { Vec2 } from './movement';

export interface StickConfig {
  /** 손잡이가 끝까지 가는 거리(조작판 높이의 %) */
  radiusPct: number;
  /** 이 비율 안쪽은 0(손떨림) */
  deadzone: number;
}

/** 조이스틱: 누른 곳에서 끈 거리(dx, dy) → 길이 0~1 벡터(끝까지 밀면 1) */
export function stickVector(dx: number, dy: number, radius: number, deadzone: number): Vec2 {
  const len = Math.hypot(dx, dy);
  if (radius <= 0 || len <= radius * deadzone) return { x: 0, y: 0 };
  const m = Math.min(1, (len - radius * deadzone) / (radius * (1 - deadzone)));
  return { x: (dx / len) * m, y: (dy / len) * m };
}

/** 손잡이 그림 위치: 반지름 안으로 가둠 */
export function clampStick(dx: number, dy: number, radius: number): Vec2 {
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: dx, y: dy };
  return { x: (dx / len) * radius, y: (dy / len) * radius };
}

export interface ViewLayout {
  /** 화면을 시계 방향 90° 돌려 그림(세로로 든 터치 기기) */
  rotated: boolean;
  /** 게임이 쓰는 가로·세로(돌렸으면 창의 세로·가로) */
  width: number;
  height: number;
}

/** 터치 기기를 세로로 들었으면 돌려서 가로 화면으로 */
export function viewLayout(winW: number, winH: number, touch: boolean): ViewLayout {
  const rotated = touch && winH > winW;
  return rotated ? { rotated, width: winH, height: winW } : { rotated, width: winW, height: winH };
}

/** 창 좌표 → 조작판(돌린 뒤) 좌표. 돌린 판은 왼쪽 위가 창의 오른쪽 위에 놓임 */
export function toView(clientX: number, clientY: number, winW: number, rotated: boolean): Vec2 {
  return rotated ? { x: clientY, y: winW - clientX } : { x: clientX, y: clientY };
}

/** 창에서 움직인 양 → 조작판에서 움직인 양 */
export function toViewDelta(dx: number, dy: number, rotated: boolean): Vec2 {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

/** 가상 패드 버튼(A·B·DUp…)에 묶인 액션들(길게 누르기 ':hold' 묶음은 뺌). 메뉴 화면의 터치 버튼이 패드와 같은 일을 하게 */
export function actionsForButton(bind: Readonly<Record<string, readonly string[]>>, button: string): string[] {
  return Object.keys(bind).filter((a) => (bind[a] ?? []).includes(button));
}
