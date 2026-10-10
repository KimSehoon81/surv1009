// 난이도 스케일링(PRD §7.3). 수치는 data/scaling.json.
import rules from '../data/scaling.json';

export interface EnemyScale {
  hp: number;
  attack: number;
  density: number;
  speed: number;
}

export const MAX_STAGE = 10;
export const LEVELS_PER_STAGE = 10;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 스테이지(1~10)·스테이지 내 레벨(1~10)의 적 배율.
 * 체력 = (1 + 0.4×(스테이지−1)) × (1 + 0.06×(레벨−1))  ← "레벨당 추가 +6%"를 스테이지 배율에 곱하는 방식으로 해석
 * 공격 = 1 + 0.25×(스테이지−1), 밀도 = 1 + 0.15×(스테이지−1), 이동속도 = 스테이지 구간별 배율
 */
export function enemyScale(stage: number, level: number, threat = 0): EnemyScale {
  const s = clamp(Math.round(stage), 1, MAX_STAGE) - 1;
  const l = clamp(Math.round(level), 1, LEVELS_PER_STAGE) - 1;
  const band = rules.speedBands.find((b) => s + 1 >= b.from && s + 1 <= b.to);
  const threatMul = 1 + rules.threatPerLevel * Math.max(0, threat);
  return {
    hp: (1 + rules.hpPerStage * s) * (1 + rules.hpPerLevel * l) * threatMul,
    attack: (1 + rules.attackPerStage * s) * threatMul,
    density: 1 + rules.densityPerStage * s,
    speed: band?.mult ?? 1,
  };
}

/** 전역 단계 N = (스테이지−1)×10 + 스테이지 내 레벨 (1~100) */
export function globalStep(stage: number, level: number): number {
  return (clamp(Math.round(stage), 1, MAX_STAGE) - 1) * LEVELS_PER_STAGE + clamp(Math.round(level), 1, LEVELS_PER_STAGE);
}
