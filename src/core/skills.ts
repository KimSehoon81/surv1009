// 고급 스킬 슬롯과 TP(PRD §6.1·§6.3). Q·E·R·F 4슬롯, 슬롯마다 {skillId, 잠금, 쿨다운}. Phaser 없음(테스트 대상).
// 발동 = 잠금 아님 + 쿨다운 끝 + TP ≥ 소모량. 연출은 호출부가 타임라인 실행기로.

export interface SkillDef {
  name: string;
  slot: string;
  tpCost: number;
  cooldownMs: number;
  /** timelines.json 이름(아직 없으면 발동 불가) */
  timeline?: string;
}

export interface SlotState {
  key: string;
  skillId: string | null;
  locked: boolean;
  /** 이 시각(전투 시계)에 쿨다운 끝 */
  readyAtMs: number;
}

export type CastReject = 'locked' | 'empty' | 'cooldown' | 'tp' | 'unimplemented';

export class SkillSlots {
  tp = 0;

  constructor(
    readonly slots: SlotState[],
    private readonly defs: Readonly<Record<string, SkillDef>>,
    readonly tpMax: number,
  ) {}

  addTp(n: number): number {
    this.tp = Math.max(0, Math.min(this.tpMax, this.tp + n));
    return this.tp;
  }

  def(i: number): SkillDef | null {
    const id = this.slots[i]?.skillId;
    return id ? (this.defs[id] ?? null) : null;
  }

  /** 발동할 수 없는 이유(되면 null) */
  check(i: number, nowMs: number): CastReject | null {
    const s = this.slots[i];
    if (!s || s.locked) return 'locked';
    const d = this.def(i);
    if (!d) return 'empty';
    if (!d.timeline) return 'unimplemented';
    if (nowMs < s.readyAtMs) return 'cooldown';
    if (this.tp < d.tpCost) return 'tp';
    return null;
  }

  /** 발동: TP 소모·쿨다운 시작. 실패면 이유 */
  cast(i: number, nowMs: number): { ok: true; def: SkillDef } | { ok: false; reason: CastReject } {
    const reason = this.check(i, nowMs);
    if (reason) return { ok: false, reason };
    const d = this.def(i) as SkillDef;
    const s = this.slots[i] as SlotState;
    this.tp -= d.tpCost;
    s.readyAtMs = nowMs + d.cooldownMs;
    return { ok: true, def: d };
  }

  /** 쿨다운 남은 비율 0~1(0이면 준비) */
  cooldownLeft(i: number, nowMs: number): number {
    const s = this.slots[i];
    const d = this.def(i);
    if (!s || !d || d.cooldownMs <= 0) return 0;
    return Math.max(0, Math.min(1, (s.readyAtMs - nowMs) / d.cooldownMs));
  }
}
