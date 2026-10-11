// 카드 판정 확률(PRD §5.1). 항목별 내역을 돌려줘 작전판(Tab)이 보여 줄 수 있게 하고, HUD는 최종값 하나만 쓴다.
// 연속 실패 완충: 표시 확률 p의 장기 평균을 유지하면서 실패할수록 실제 확률이 오르는 의사난수 분포
// P(n번째 시도) = min(1, C·n). p = 30%면 C ≈ 0.119 → 9번째에는 반드시 성공(최장 연패 8회).

export interface ChanceRules {
  baseChance: number;
  countBonus: Readonly<Record<string, number>>;
  intelBonus: number;
  gambleBonus: number;
  luckPerPoint: number;
  cap: number;
}

export interface ChanceInput {
  /** 마이너스를 뺀 실제 카드 수 */
  realCount: number;
  hasIntel: boolean;
  /** 척후 보고(P10) 대기 보너스: 정보 보너스와 중복되지 않음 */
  intelPrimed: boolean;
  /** 마이너스를 끼운 무리수 */
  gamble: boolean;
  luck: number;
  /** 업그레이드·메타 작전 숙련 등 추가 %p */
  extra: number;
  /** 오보(M01) 등 판정 감점 합(양수) */
  penalty: number;
  /** 환경 방해 감점 합(방공망 등, 양수) */
  envPenalty: number;
  seal: boolean;
}

export type ChanceKey = 'base' | 'count' | 'intel' | 'luck' | 'extra' | 'gamble' | 'penalty' | 'env';

export interface ChanceResult {
  terms: { key: ChanceKey; value: number }[];
  /** 자르기 전 합 */
  raw: number;
  /** 표시·판정 확률(0~cap, 인장이면 1) */
  final: number;
}

export function chanceBreakdown(i: ChanceInput, r: ChanceRules): ChanceResult {
  const terms: ChanceResult['terms'] = [{ key: 'base', value: r.baseChance }];
  const count = r.countBonus[String(Math.min(3, i.realCount))] ?? 0;
  if (count) terms.push({ key: 'count', value: count });
  if (i.hasIntel || i.intelPrimed) terms.push({ key: 'intel', value: r.intelBonus });
  if (i.luck) terms.push({ key: 'luck', value: i.luck * r.luckPerPoint });
  if (i.extra) terms.push({ key: 'extra', value: i.extra });
  if (i.gamble) terms.push({ key: 'gamble', value: r.gambleBonus });
  if (i.penalty) terms.push({ key: 'penalty', value: -i.penalty });
  if (i.envPenalty) terms.push({ key: 'env', value: -i.envPenalty });
  const raw = terms.reduce((s, t) => s + t.value, 0);
  const final = i.seal ? 1 : Math.min(r.cap, Math.max(0, raw));
  return { terms, raw, final };
}

/** C로 만든 분포의 장기 평균 성공률 */
function averageRate(c: number): number {
  let expected = 0;
  let survive = 1;
  for (let n = 1; survive > 1e-12; n++) {
    const p = Math.min(1, c * n);
    expected += n * survive * p;
    survive *= 1 - p;
  }
  return 1 / expected;
}

const cCache = new Map<number, number>();

/** 장기 평균이 p가 되는 C(이분법, 0.1%p 단위로 기억) */
export function pseudoRandomC(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const key = Math.round(p * 1000);
  const hit = cCache.get(key);
  if (hit !== undefined) return hit;
  const target = key / 1000;
  let lo = 0;
  let hi = target;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (averageRate(mid) < target) lo = mid;
    else hi = mid;
  }
  const c = (lo + hi) / 2;
  cCache.set(key, c);
  return c;
}

/** 연속 실패 failStreak번 뒤 이번 시도의 실제 성공 확률 */
export function pityChance(p: number, failStreak: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return Math.min(1, pseudoRandomC(p) * (failStreak + 1));
}
