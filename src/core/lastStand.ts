// 구사일생: 판마다 정해진 횟수만큼, 쓰러질 피해를 받아도 체력을 조금 남기고 버틴다. Phaser 없음

export interface LastStandCfg {
  /** 판마다 몇 번 */
  uses: number;
  /** 버틴 뒤 체력(최대 체력의 비율) */
  hpRatio: number;
}

export interface LethalResult {
  saved: boolean;
  hp: number;
  used: number;
}

/** 피해를 받은 뒤의 체력(hp ≤ 0이면 쓰러질 상황)을 넘기면: 남은 횟수가 있으면 버팀 */
export function resolveLethal(hp: number, maxHp: number, used: number, cfg: LastStandCfg): LethalResult {
  if (hp > 0) return { saved: false, hp, used };
  if (used >= cfg.uses) return { saved: false, hp: 0, used };
  return { saved: true, hp: Math.max(1, Math.round(maxHp * cfg.hpRatio)), used: used + 1 };
}
