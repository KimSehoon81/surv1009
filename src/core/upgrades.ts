// 레벨업 업그레이드 추첨(PRD §4.2). 레어도는 선택지마다 따로 뽑고, 행운·카드 보정(희귀 이상 +%p)·수치 배율은 ctx로 받는다
// (D09의 참모 회의 4지선다·정찰 보고서·작전계획서가 ctx만 바꿔서 붙도록).

import type { Rng } from './rng';
import type { StatMod } from './stats';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'legendary'];

export interface RarityConfig {
  weights: Record<Rarity, number>;
  /** 행운 1당 가중치 증가 비율 */
  luckK: Record<Rarity, number>;
  /** 레어도별 수치 배율 */
  value: Record<Rarity, number>;
}

export interface UpgradeMod extends StatMod {
  fmt?: string;
}

export interface UpgradeDef {
  id: string;
  kind: string;
  name: string;
  icon: string;
  desc: string;
  maxLevel: number;
  weight: number;
  /** 'player' 또는 'weapon:<무기ID>' */
  target: string;
  mods: readonly UpgradeMod[];
  scales?: boolean;
  addWeapon?: string;
  requires?: { weapon?: string; notWeapon?: string };
  heal?: number;
  pullAll?: boolean;
}

export interface RollContext {
  count: number;
  luck: number;
  /** 희귀 이상 확률을 이만큼(0~1) 끌어올림(정찰 보고서 +0.3) */
  rarePlusBonus: number;
  /** 수치 배율(작전계획서 2) */
  valueMultiplier: number;
  /** 업그레이드 ID → 지금까지 고른 단계 */
  owned: Readonly<Record<string, number>>;
  /** 장착 중인 무기 ID */
  weapons: readonly string[];
}

export interface Choice {
  def: UpgradeDef;
  rarity: Rarity;
  /** 레어도·배율이 적용된 수정자 */
  mods: UpgradeMod[];
  fallback: boolean;
}

/** 레어도 확률(합 1). 행운이 오를수록 희귀 이상이 단조 증가, rarePlusBonus는 희귀+전설 몫을 그만큼 늘림 */
export function rarityProbs(cfg: RarityConfig, luck: number, rarePlusBonus = 0): Record<Rarity, number> {
  const w: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  let total = 0;
  for (const r of RARITIES) {
    w[r] = Math.max(0, cfg.weights[r] * (1 + Math.max(0, luck) * cfg.luckK[r]));
    total += w[r];
  }
  const p: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const r of RARITIES) p[r] = total > 0 ? w[r] / total : r === 'common' ? 1 : 0;
  const bonus = Math.max(0, rarePlusBonus);
  if (bonus > 0) {
    const low = p.common + p.uncommon;
    const high = p.rare + p.legendary;
    const move = Math.min(bonus, low);
    if (low > 0) {
      p.common -= (move * p.common) / low;
      p.uncommon -= (move * p.uncommon) / low;
    }
    if (high > 0) {
      p.rare += (move * p.rare) / high;
      p.legendary += (move * p.legendary) / high;
    } else p.rare += move;
  }
  return p;
}

export function rollRarity(probs: Record<Rarity, number>, rng: Rng): Rarity {
  let x = rng.next();
  for (const r of RARITIES) {
    x -= probs[r];
    if (x < 0) return r;
  }
  return 'common';
}

/** 지금 고를 수 있는 업그레이드: 최대 단계 미만 + 무기 조건 충족 */
export function eligible(defs: readonly UpgradeDef[], ctx: RollContext): UpgradeDef[] {
  return defs.filter((d) => {
    if ((ctx.owned[d.id] ?? 0) >= d.maxLevel) return false;
    if (d.requires?.weapon && !ctx.weapons.includes(d.requires.weapon)) return false;
    if (d.requires?.notWeapon && ctx.weapons.includes(d.requires.notWeapon)) return false;
    return d.weight > 0;
  });
}

export function scaleMods(def: UpgradeDef, rarity: Rarity, cfg: RarityConfig, valueMultiplier: number): UpgradeMod[] {
  const k = def.scales === false ? 1 : cfg.value[rarity] * valueMultiplier;
  return def.mods.map((m) => ({ ...m, value: m.value * k }));
}

/** 가중치로 중복 없이 count개 + 모자라면 대체 보상으로 채움 */
export function rollChoices(
  defs: readonly UpgradeDef[],
  fallbacks: readonly UpgradeDef[],
  cfg: RarityConfig,
  ctx: RollContext,
  rng: Rng,
): Choice[] {
  const pool = eligible(defs, ctx);
  const probs = rarityProbs(cfg, ctx.luck, ctx.rarePlusBonus);
  const out: Choice[] = [];
  while (out.length < ctx.count && pool.length > 0) {
    const total = pool.reduce((s, d) => s + d.weight, 0);
    let x = rng.next() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      x -= (pool[idx] as UpgradeDef).weight;
      if (x < 0) break;
    }
    const def = pool.splice(idx, 1)[0] as UpgradeDef;
    const rarity = def.scales === false ? 'common' : rollRarity(probs, rng);
    out.push({ def, rarity, mods: scaleMods(def, rarity, cfg, ctx.valueMultiplier), fallback: false });
  }
  for (const def of fallbacks) {
    if (out.length >= ctx.count) break;
    out.push({ def, rarity: 'common', mods: [], fallback: true });
  }
  return out;
}

/** 설명 문구: {0}{1}… 자리에 수정자 값(fmt pct면 ×100, 정수로) */
export function describe(def: UpgradeDef, mods: readonly UpgradeMod[]): string {
  return def.desc.replace(/\{(\d+)\}/g, (_, i: string) => {
    const m = mods[Number(i)];
    if (!m) return '?';
    const v = m.fmt === 'pct' ? m.value * 100 : m.value;
    return String(Math.round(v * 10) / 10);
  });
}
