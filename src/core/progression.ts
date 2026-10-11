// 한 판 안의 성장 흐름: 경험치 → 레벨업 대기열 → 3지선다 → 적용. Phaser 없음(테스트 대상).
// 레벨업이 여러 번 쌓이면 하나씩 차례로 연다(PRD §3). 적용 대상(플레이어·무기)은 인터페이스로만 안다.

import { gainXp, xpToNext, type XpConfig, type XpState } from './xp';
import { rollChoices, type Choice, type RarityConfig, type RollContext, type UpgradeDef, type UpgradeMod } from './upgrades';
import type { Rng } from './rng';

export interface UpgradeTarget {
  readonly luck: number;
  readonly weapons: readonly string[];
  addPlayerMods(mods: readonly UpgradeMod[]): void;
  addWeaponMods(weaponId: string, mods: readonly UpgradeMod[]): void;
  addWeapon(weaponId: string): void;
  /** 최대 체력 비율만큼 회복 */
  heal(fraction: number): void;
  /** 떨어진 경험치 보급품 전부 회수 */
  pullAll(): void;
}

export interface ProgressionConfig {
  xp: XpConfig;
  rarity: RarityConfig;
  upgrades: readonly UpgradeDef[];
  fallbacks: readonly UpgradeDef[];
  rerolls: number;
}

/** 다음 레벨업 한 번에만 적용할 보정(D09 카드: 참모 회의 4지선다, 정찰 보고서 희귀 +30%p, 작전계획서 200%) */
export interface NextRollBonus {
  count?: number;
  rarePlusBonus?: number;
  valueMultiplier?: number;
}

export class Progression {
  xp: XpState = { level: 1, xp: 0 };
  readonly owned: Record<string, number> = {};
  /** 고른 순서 기록(일시정지 화면 목록·정산용) */
  readonly history: { id: string; rarity: string }[] = [];
  rerolls: number;
  /** 아직 열지 않은 레벨업 수 */
  pending = 0;
  choices: Choice[] | null = null;
  nextBonus: NextRollBonus = {};
  private openCtx: RollContext | null = null;

  constructor(
    private readonly cfg: ProgressionConfig,
    private readonly rng: Rng,
  ) {
    this.rerolls = cfg.rerolls;
  }

  get level(): number {
    return this.xp.level;
  }

  /** 다음 레벨까지 진행률 0~1(최대 레벨이면 1) */
  get progress(): number {
    const need = xpToNext(this.xp.level, this.cfg.xp);
    return Number.isFinite(need) ? Math.min(1, this.xp.xp / need) : 1;
  }

  get isOpen(): boolean {
    return this.choices !== null;
  }

  /** 경험치 획득. 오른 레벨 수만큼 대기열에 쌓고 그 수를 돌려준다 */
  addXp(amount: number): number {
    const r = gainXp(this.xp, amount, this.cfg.xp);
    this.xp = r.state;
    this.pending += r.levelsGained;
    return r.levelsGained;
  }

  /** 대기 중인 레벨업이 있으면 선택지를 뽑아 연다 */
  open(target: UpgradeTarget): Choice[] | null {
    if (this.isOpen || this.pending <= 0) return this.choices;
    const b = this.nextBonus;
    this.nextBonus = {};
    this.openCtx = {
      count: b.count ?? 3,
      luck: target.luck,
      rarePlusBonus: b.rarePlusBonus ?? 0,
      valueMultiplier: b.valueMultiplier ?? 1,
      owned: { ...this.owned },
      weapons: [...target.weapons],
    };
    this.choices = rollChoices(this.cfg.upgrades, this.cfg.fallbacks, this.cfg.rarity, this.openCtx, this.rng);
    return this.choices;
  }

  /** 같은 보정으로 다시 뽑기. 횟수가 없으면 false */
  reroll(): boolean {
    if (!this.isOpen || !this.openCtx || this.rerolls <= 0) return false;
    this.rerolls--;
    this.choices = rollChoices(this.cfg.upgrades, this.cfg.fallbacks, this.cfg.rarity, this.openCtx, this.rng);
    return true;
  }

  /** i번째 선택지를 적용하고 창을 닫는다. 남은 레벨업이 있으면 호출부가 다시 open한다 */
  choose(index: number, target: UpgradeTarget): Choice | null {
    const c = this.choices?.[index];
    if (!c) return null;
    const d = c.def;
    if (d.addWeapon) target.addWeapon(d.addWeapon);
    if (c.mods.length > 0) {
      if (d.target === 'player') target.addPlayerMods(c.mods);
      else if (d.target.startsWith('weapon:')) target.addWeaponMods(d.target.slice('weapon:'.length), c.mods);
    }
    if (d.heal) target.heal(d.heal);
    if (d.pullAll) target.pullAll();
    if (!c.fallback) this.owned[d.id] = (this.owned[d.id] ?? 0) + 1;
    this.history.push({ id: d.id, rarity: c.rarity });
    this.pending--;
    this.choices = null;
    this.openCtx = null;
    return c;
  }
}
