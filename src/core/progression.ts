// 한 판 안의 성장 흐름: 경험치 → 레벨업 대기열 → 3지선다 → 적용. Phaser 없음(테스트 대상).
// 레벨업이 여러 번 쌓이면 하나씩 차례로 연다(PRD §3). 적용 대상(플레이어·무기)은 인터페이스로만 안다.

import { gainXp, xpToNext, type XpConfig, type XpState } from './xp';
import { rollChoices, type Choice, type RarityConfig, type RollContext, type UpgradeDef, type UpgradeMod } from './upgrades';
import type { Rng } from './rng';

export interface UpgradeTarget {
  readonly luck: number;
  readonly weapons: readonly string[];
  /** 레벨업 희귀 이상 가중 보정(캐릭터 상시, A30 참모장교) */
  readonly rarePlus?: number;
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
  /** 조합 성공 누적으로 생긴 전술 선택지(다음 레벨업에 1개씩 추가, PRD §5.5) */
  tacticalSlots = 0;
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
      rarePlusBonus: (b.rarePlusBonus ?? 0) + (target.rarePlus ?? 0),
      valueMultiplier: b.valueMultiplier ?? 1,
      owned: { ...this.owned },
      weapons: [...target.weapons],
    };
    this.choices = this.roll(this.openCtx);
    return this.choices;
  }

  /** 일반 추첨(전술 종류 제외) + 전술 선택지(전술·카드 종류에서 1개) */
  private roll(ctx: RollContext): Choice[] {
    const normal = this.cfg.upgrades.filter((d) => d.kind !== 'tactical');
    const out = rollChoices(normal, this.cfg.fallbacks, this.cfg.rarity, ctx, this.rng);
    if (this.tacticalSlots > 0) {
      const taken = new Set(out.map((c) => c.def.id));
      const pool = this.cfg.upgrades.filter((d) => (d.kind === 'tactical' || d.kind === 'card') && !taken.has(d.id));
      const extra = rollChoices(pool, [], this.cfg.rarity, { ...ctx, count: 1 }, this.rng);
      out.push(...extra);
    }
    return out;
  }

  private apply(c: Choice, target: UpgradeTarget): void {
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
  }

  /**
   * 보물 상자(2026-11-14): 레벨업 창 없이 n개를 하나씩 바로 뽑아 적용(희귀 이상 가중 rarePlusBonus).
   * 하나 받을 때마다 보유 수가 바뀌므로 매번 다시 뽑는다(최대 단계 넘김 없음). 레벨업 대기열·전술 칸은 그대로
   */
  grant(n: number, target: UpgradeTarget, rarePlusBonus = 0): Choice[] {
    const got: Choice[] = [];
    const normal = this.cfg.upgrades.filter((d) => d.kind !== 'tactical' && d.kind !== 'card');
    for (let i = 0; i < n; i++) {
      const ctx: RollContext = {
        count: 1,
        luck: target.luck,
        rarePlusBonus: rarePlusBonus + (target.rarePlus ?? 0),
        valueMultiplier: 1,
        owned: { ...this.owned },
        weapons: [...target.weapons],
      };
      const c = rollChoices(normal, this.cfg.fallbacks, this.cfg.rarity, ctx, this.rng)[0];
      if (!c) break;
      this.apply(c, target);
      got.push(c);
    }
    return got;
  }

  /** 같은 보정으로 다시 뽑기. 횟수가 없으면 false */
  reroll(): boolean {
    if (!this.isOpen || !this.openCtx || this.rerolls <= 0) return false;
    this.rerolls--;
    this.choices = this.roll(this.openCtx);
    return true;
  }

  /** i번째 선택지를 적용하고 창을 닫는다. 남은 레벨업이 있으면 호출부가 다시 open한다 */
  choose(index: number, target: UpgradeTarget): Choice | null {
    const c = this.choices?.[index];
    if (!c) return null;
    this.apply(c, target);
    this.pending--;
    // 전술 선택지가 붙은 창을 닫으면(무엇을 골랐든) 슬롯 1개 소모
    if (this.tacticalSlots > 0) this.tacticalSlots--;
    this.choices = null;
    this.openCtx = null;
    return c;
  }
}
