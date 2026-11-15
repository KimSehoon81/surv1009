// 스테이지 안 레벨(PRD §4.2). 필요 경험치 = round(base × growth^(Lv−1)), maxLevel 이후는 레벨업 없음.
// softCap(보스가 나오는 레벨) 뒤로는 overGrowth로 완만하게 늘어 계속 오를 수 있다(2026-11-15: 대신 보스 공격이 잦아짐, core/stage bossAttackRate).

export interface XpConfig {
  base: number;
  growth: number;
  maxLevel: number;
  /** 앞 레벨 필요 경험치 덮어쓰기(Lv1→2부터). 첫 레벨업을 빨리 맛보게 */
  first?: number[];
  /** 이 레벨부터는 필요 경험치가 overGrowth 배씩만 늘어남(없으면 끝까지 growth) */
  softCap?: number;
  overGrowth?: number;
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
  const soft = cfg.softCap;
  if (soft !== undefined && level >= soft) return Math.round(cfg.base * cfg.growth ** (soft - 2) * (cfg.overGrowth ?? cfg.growth) ** (level - soft + 1));
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
