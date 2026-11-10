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

/** 군집 대기열(D33): 남은 자리(room)만큼 꺼낸다. 상한이 우선이고 남은 수는 다음 프레임에 */
export interface BurstJob {
  id: string;
  left: number;
  /** 원호 가운데 각(라디안)과 폭 */
  angle: number;
  arcRad: number;
}

export function takeBurst(queue: readonly BurstJob[], room: number): { spawn: { id: string; angle: number; arcRad: number }[]; queue: BurstJob[] } {
  const spawn: { id: string; angle: number; arcRad: number }[] = [];
  const rest: BurstJob[] = [];
  let left = Math.max(0, room);
  for (const j of queue) {
    const n = Math.min(left, j.left);
    for (let i = 0; i < n; i++) spawn.push({ id: j.id, angle: j.angle, arcRad: j.arcRad });
    left -= n;
    if (j.left - n > 0) rest.push({ ...j, left: j.left - n });
  }
  return { spawn, queue: rest };
}

export function ringPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}
