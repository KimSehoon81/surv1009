// 고지 점령(기믹): 전장에 생기는 원 안에서 버티면 깃발이 올라가고, 다 올라가면 점령(보상). Phaser 없음
// 원 밖에 있으면 올린 만큼이 천천히 내려가고, 제한 시간 안에 못 올리면 사라진다.

export interface OutpostCfg {
  /** 원 반지름(px) */
  radius: number;
  /** 원 안에서 버텨야 하는 시간 */
  captureMs: number;
  /** 원 밖에 있을 때 진행이 줄어드는 속도(1 = 올라가는 속도와 같음) */
  decayMul: number;
  /** 이 시간 안에 점령 못 하면 사라짐(원 안에 있는 동안은 사라지지 않음) */
  lifeMs: number;
}

export interface OutpostState {
  x: number;
  y: number;
  bornMs: number;
  progressMs: number;
}

export type OutpostStep = 'hold' | 'captured' | 'expired';

export function insideOutpost(s: Pick<OutpostState, 'x' | 'y'>, px: number, py: number, radius: number): boolean {
  const dx = px - s.x;
  const dy = py - s.y;
  return dx * dx + dy * dy <= radius * radius;
}

/** dtMs만큼 진행: 새 진행 시간과 결과 */
export function stepOutpost(s: OutpostState, inside: boolean, dtMs: number, nowMs: number, cfg: OutpostCfg): { progressMs: number; step: OutpostStep } {
  const progressMs = inside ? s.progressMs + dtMs : Math.max(0, s.progressMs - dtMs * cfg.decayMul);
  if (progressMs >= cfg.captureMs) return { progressMs: cfg.captureMs, step: 'captured' };
  if (!inside && nowMs - s.bornMs >= cfg.lifeMs) return { progressMs, step: 'expired' };
  return { progressMs, step: 'hold' };
}

/** 깃발 높이·진행 고리에 쓰는 0~1 */
export function outpostRatio(s: Pick<OutpostState, 'progressMs'>, cfg: Pick<OutpostCfg, 'captureMs'>): number {
  return Math.max(0, Math.min(1, s.progressMs / Math.max(1, cfg.captureMs)));
}
