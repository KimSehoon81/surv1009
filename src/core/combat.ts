// 피해 판정(순수 함수, PRD §4.1·§4.3). 확률은 시드 RNG만 사용하고 소비 순서는 치명타 → 방어로 고정.

export interface HitInput {
  attack: number;
  critChance: number;
  critMult: number;
  /** 맞는 쪽 방어력(방어 확률에만 쓰인다) */
  defense: number;
  blockK: number;
  blockReduction: number;
  maxBlockChance: number;
}

export interface HitResult {
  damage: number;
  crit: boolean;
  blocked: boolean;
}

export interface ChanceSource {
  chance(p: number): boolean;
}

/** 방어 확률 = 방어력/(방어력+K), 상한 max. 방어력이 오를수록 효과가 줄어드는 곡선 */
export function blockChance(defense: number, k: number, max: number): number {
  if (defense <= 0) return 0;
  return Math.min(max, defense / (defense + k));
}

export function computeHit(h: HitInput, rng: ChanceSource): HitResult {
  const crit = rng.chance(h.critChance);
  const blocked = rng.chance(blockChance(h.defense, h.blockK, h.maxBlockChance));
  const raw = h.attack * (crit ? h.critMult : 1) * (blocked ? 1 - h.blockReduction : 1);
  return { damage: Math.max(1, Math.round(raw)), crit, blocked };
}
