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
  /** 회피 확률(맞는 쪽, D31 A24·A27): 회피하면 피해 0 */
  dodgeChance?: number;
}

export interface HitResult {
  damage: number;
  crit: boolean;
  blocked: boolean;
  /** 회피함(피해 0) */
  dodged?: boolean;
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
  // 회피는 확률이 있을 때만 굴림(없으면 난수 순서가 그대로라 기존 판정이 바뀌지 않음)
  if ((h.dodgeChance ?? 0) > 0 && rng.chance(h.dodgeChance ?? 0)) return { damage: 0, crit: false, blocked: false, dodged: true };
  const crit = rng.chance(h.critChance);
  const blocked = rng.chance(blockChance(h.defense, h.blockK, h.maxBlockChance));
  const raw = h.attack * (crit ? h.critMult : 1) * (blocked ? 1 - h.blockReduction : 1);
  return { damage: Math.max(1, Math.round(raw)), crit, blocked };
}

/** 장갑 종류별 받는 피해 배율(combat.json armor). 표에 없으면 1 */
export function armorMult(armorType: string | undefined, attackKind: string, table: Readonly<Record<string, Readonly<Record<string, number>>>>): number {
  return table[armorType ?? 'none']?.[attackKind] ?? 1;
}
