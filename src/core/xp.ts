// 스테이지 안 레벨(PRD §4.2). 필요 경험치 = round(base × growth^(Lv−1)), maxLevel 이후는 레벨업 없음.

export interface XpConfig {
  base: number;
  growth: number;
  maxLevel: number;
  /** 앞 레벨 필요 경험치 덮어쓰기(Lv1→2부터). 첫 레벨업을 빨리 맛보게 */
  first?: number[];
}

export interface XpState {
  level: number;
  /** 다음 레벨까지 모은 경험치 */
  xp: number;
}

export function xpToNext(level: number, cfg: XpConfig): number {
  if (level >= cfg.maxLevel) return Infinity;
  const early = cfg.first?.[level - 1];
  if (early !== undefined) return early;
  return Math.round(cfg.base * cfg.growth ** (level - 1));
}

/** 경험치를 더하고 오른 레벨 수를 돌려준다(한 번에 여러 레벨 가능). 최대 레벨에서는 경험치가 쌓이지 않는다 */
export function gainXp(state: XpState, amount: number, cfg: XpConfig): { state: XpState; levelsGained: number } {
  let { level, xp } = state;
  if (level >= cfg.maxLevel) return { state: { level, xp: 0 }, levelsGained: 0 };
  xp += Math.max(0, amount);
  let gained = 0;
  for (let need = xpToNext(level, cfg); xp >= need; need = xpToNext(level, cfg)) {
    xp -= need;
    level++;
    gained++;
    if (level >= cfg.maxLevel) {
      xp = 0;
      break;
    }
  }
  return { state: { level, xp }, levelsGained: gained };
}
