// 보물 상자 규칙(2026-11-14): 누가 떨어뜨리나·몇 개 받나. Phaser 없음(테스트 대상)
import type { Rng } from './rng';
import { pickWeighted } from './support';

export interface ChestConfig {
  dropTiers: readonly string[];
  normalChance: number;
  counts: readonly { id: string; n: number; weight: number }[];
}

/** 이 등급 적이 상자를 떨어뜨리나(엘리트는 늘, 일반은 낮은 확률). 보스는 쓰러뜨리면 바로 점령이라 없음 */
export function dropsChest(tier: string, rng: Rng, cfg: ChestConfig): boolean {
  if (cfg.dropTiers.includes(tier)) return true;
  return tier === 'normal' && rng.next() < cfg.normalChance;
}

/** 받을 업그레이드 수(가중치) */
export function chestCount(rng: Rng, cfg: ChestConfig): number {
  return pickWeighted(rng, cfg.counts)?.n ?? 1;
}
