// 다중 처치(2026-11-14): 짧은 시간 안에 이어진 처치 수를 세어 단계에 닿는 순간을 알린다(범위 공격의 손맛). Phaser 없음
export interface MultiKillCfg {
  /** 앞 처치에서 이 시간(ms) 안에 이어지면 같은 묶음 */
  windowMs: number;
  /** 연출을 내는 처치 수(오름차순) */
  tiers: number[];
}

export interface MultiKillState {
  count: number;
  lastMs: number;
  sumX: number;
  sumY: number;
}

export const newMultiKill = (): MultiKillState => ({ count: 0, lastMs: -Infinity, sumX: 0, sumY: 0 });

/** 처치 하나를 기록. 묶음의 처치 수가 tiers의 한 값에 딱 닿았으면 그 단계(1부터), 아니면 0 */
export function registerKill(s: MultiKillState, nowMs: number, x: number, y: number, cfg: MultiKillCfg): number {
  if (nowMs - s.lastMs > cfg.windowMs) {
    s.count = 0;
    s.sumX = 0;
    s.sumY = 0;
  }
  s.count++;
  s.lastMs = nowMs;
  s.sumX += x;
  s.sumY += y;
  return cfg.tiers.indexOf(s.count) + 1;
}

/** 묶음의 가운데(연출 자리) */
export function killCenter(s: MultiKillState): { x: number; y: number } {
  const n = Math.max(1, s.count);
  return { x: s.sumX / n, y: s.sumY / n };
}
