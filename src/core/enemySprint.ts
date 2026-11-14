// 적 질주(2026-11-14 사용자 요청): 아주 가끔 돌격형 일반 적 몇이 플레이어 질주(C)처럼 짧게 빨리 달린다.
// 예고(웅크림 + '!') → 질주 → 부드럽게 원래 속도. Phaser 없음(테스트 대상)
import type { Rng } from './rng';

export interface EnemySprintConfig {
  firstSec: number;
  everySec: number;
  /** 주기 흔들림 비율(±) */
  jitter: number;
  /** 한 번에 질주하는 적 수 [최소, 최대] */
  count: [number, number];
  windupMs: number;
  durationMs: number;
  speedMul: number;
  /** 예고 동안 속도 배율(웅크림) */
  windupMul: number;
  easeOutMs: number;
  tiers: string[];
  /** 이 행동 부품이 있는 적만(돌격형) */
  behaviors: string[];
}

/** 질주 시작 시각 기준 지금 속도 배율: 예고 = windupMul, 질주 = speedMul(끝에서 1로), 그 밖 1 */
export function enemySprintMul(startMs: number, nowMs: number, cfg: EnemySprintConfig): number {
  if (nowMs < startMs - cfg.windupMs || nowMs >= startMs + cfg.durationMs) return 1;
  if (nowMs < startMs) return cfg.windupMul;
  const left = startMs + cfg.durationMs - nowMs;
  const k = cfg.easeOutMs > 0 ? Math.min(1, left / cfg.easeOutMs) : 1;
  return 1 + (cfg.speedMul - 1) * k;
}

export type SprintPhase = 'none' | 'windup' | 'run';
export function enemySprintPhase(startMs: number, nowMs: number, cfg: EnemySprintConfig): SprintPhase {
  if (nowMs < startMs - cfg.windupMs || nowMs >= startMs + cfg.durationMs) return 'none';
  return nowMs < startMs ? 'windup' : 'run';
}

/** 이 적이 질주할 수 있는지: 등급·돌격형 행동·공중 아님 */
export function canSprint(def: { tier?: string; air?: boolean; behaviors?: readonly { type: string }[] }, cfg: EnemySprintConfig): boolean {
  if (def.air || !cfg.tiers.includes(def.tier ?? '')) return false;
  const types = (def.behaviors ?? []).map((b) => b.type);
  return types.some((t) => cfg.behaviors.includes(t)) && !types.includes('keepDistance') && !types.includes('stationary');
}

/** 후보 중 무작위로 count개(같은 시드면 같은 선택) */
export function pickSprinters<T>(candidates: readonly T[], rng: Rng, cfg: EnemySprintConfig): T[] {
  const [lo, hi] = cfg.count;
  const n = Math.min(candidates.length, lo + Math.floor(rng.next() * (hi - lo + 1)));
  const pool = [...candidates];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(...pool.splice(Math.floor(rng.next() * pool.length), 1));
  return out;
}

/** 다음 질주 시각(초): 주기 ± jitter */
export const nextSprintSec = (nowSec: number, rng: Rng, cfg: EnemySprintConfig): number => nowSec + cfg.everySec * (1 - cfg.jitter + 2 * cfg.jitter * rng.next());
