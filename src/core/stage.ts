// 스테이지 진행(PRD §3 타임라인·진행 원칙 v0.2). 시간 구간별 스폰 표, 밀도 배율(대군집·숨 고르기),
// 엘리트·방해·보스의 예고 → 등장 이벤트. Phaser 없음(테스트 대상). 시각은 전투 시계 초.

export interface SpawnEntry {
  enemy: string;
  perSec: number;
}

export interface StagePhase {
  from: number;
  to: number | null;
  spawns: readonly SpawnEntry[];
}

export interface PacingEntry {
  from: number;
  to: number;
  mult: number;
  label?: string;
}

export interface DisruptionDef {
  type: string;
  /** a = 카드를 가리는 방해(동시 1개 제한) */
  category: string;
  firstAt: number;
  intervalSec: number;
  durationSec: number;
  warnSec: number;
  minEnemiesOnScreen?: number;
  priority: number;
  /** 출처(stage·적·NPC 등, G6: 방해를 건 적을 처치하면 해제) */
  source: string;
}

export interface StageDef {
  name: string;
  region: string;
  floor: string;
  maxAlive: number;
  phases: readonly StagePhase[];
  pacing: readonly PacingEntry[];
  elites: readonly { at: number; enemy: string; warnSec: number }[];
  boss: { enemy: string; trigger: { level: number; time: number }; warnSec: number; spawnMult: number };
  disruptions: readonly DisruptionDef[];
  npcAt?: readonly number[];
}

export type StageEvent =
  | { type: 'eliteWarn'; enemy: string; inSec: number }
  | { type: 'elite'; enemy: string }
  | { type: 'bossWarn'; enemy: string; inSec: number }
  | { type: 'boss'; enemy: string }
  | { type: 'disruptionWarn'; def: DisruptionDef; inSec: number }
  | { type: 'disruption'; def: DisruptionDef }
  | { type: 'pacing'; label: string; mult: number };

export function phaseAt(stage: StageDef, t: number): StagePhase {
  return stage.phases.find((p) => t >= p.from && (p.to === null || t < p.to)) ?? (stage.phases[stage.phases.length - 1] as StagePhase);
}

export function pacingAt(stage: StageDef, t: number): PacingEntry | null {
  return stage.pacing.find((p) => t >= p.from && t < p.to) ?? null;
}

/** 새 요소(적 첫 등장·엘리트 첫 등장·방해 첫 발생·NPC)가 처음 나오는 시각들(진행 원칙 검사용) */
export function introductions(stage: StageDef): { at: number; what: string }[] {
  const out: { at: number; what: string }[] = [];
  const seen = new Set<string>();
  for (const p of stage.phases) {
    for (const s of p.spawns) {
      if (seen.has(s.enemy)) continue;
      seen.add(s.enemy);
      out.push({ at: p.from, what: s.enemy });
    }
  }
  for (const e of stage.elites) {
    if (seen.has(e.enemy)) continue;
    seen.add(e.enemy);
    out.push({ at: e.at, what: e.enemy });
  }
  for (const d of stage.disruptions) out.push({ at: d.firstAt, what: d.type });
  for (const n of stage.npcAt ?? []) out.push({ at: n, what: 'npc' });
  return out.sort((a, b) => a.at - b.at);
}

/** 시간·레벨을 받아 예고와 등장 이벤트를 한 번씩 낸다 */
export class StageDirector {
  /** 보스 등장 시각(경고가 시작되면 정해짐) */
  bossAt: number | null = null;
  bossSpawned = false;
  private eliteDone: boolean[];
  private eliteWarned: boolean[];
  private disruptionNext: number[];
  /** 예고한 방해의 시작 시각(-1이면 없음) */
  private disruptionPending: number[];
  private lastPacing: PacingEntry | null = null;

  constructor(readonly stage: StageDef) {
    this.eliteDone = stage.elites.map(() => false);
    this.eliteWarned = stage.elites.map(() => false);
    this.disruptionNext = stage.disruptions.map((d) => d.firstAt);
    this.disruptionPending = stage.disruptions.map(() => -1);
  }

  /** 지금 스폰 표와 밀도 배율(보스전이면 보스 배율까지) */
  spawnsAt(t: number): { spawns: readonly SpawnEntry[]; mult: number } {
    const pace = pacingAt(this.stage, t)?.mult ?? 1;
    return { spawns: phaseAt(this.stage, t).spawns, mult: pace * (this.bossSpawned ? this.stage.boss.spawnMult : 1) };
  }

  update(t: number, level: number, ctx: { enemiesOnScreen: number }): StageEvent[] {
    const ev: StageEvent[] = [];
    const st = this.stage;
    st.elites.forEach((e, i) => {
      if (!this.eliteWarned[i] && t >= e.at - e.warnSec) {
        this.eliteWarned[i] = true;
        ev.push({ type: 'eliteWarn', enemy: e.enemy, inSec: Math.max(0, e.at - t) });
      }
      if (!this.eliteDone[i] && t >= e.at) {
        this.eliteDone[i] = true;
        ev.push({ type: 'elite', enemy: e.enemy });
      }
    });
    st.disruptions.forEach((d, i) => {
      const pending = this.disruptionPending[i] ?? -1;
      if (pending >= 0) {
        if (t >= pending) {
          this.disruptionPending[i] = -1;
          this.disruptionNext[i] = pending + d.intervalSec;
          ev.push({ type: 'disruption', def: d });
        }
        return;
      }
      const next = this.disruptionNext[i] ?? Infinity;
      if (t < next - d.warnSec) return;
      // 조건(화면 적 밀도)이 안 되면 5초 뒤 다시 본다
      if ((ctx.enemiesOnScreen ?? 0) < (d.minEnemiesOnScreen ?? 0)) {
        this.disruptionNext[i] = t + d.warnSec + 5;
        return;
      }
      this.disruptionPending[i] = t + d.warnSec;
      ev.push({ type: 'disruptionWarn', def: d, inSec: d.warnSec });
    });
    const b = st.boss;
    if (this.bossAt === null && (level >= b.trigger.level || t >= b.trigger.time - b.warnSec)) {
      this.bossAt = level >= b.trigger.level ? t + b.warnSec : Math.max(t, b.trigger.time);
      ev.push({ type: 'bossWarn', enemy: b.enemy, inSec: this.bossAt - t });
    }
    if (this.bossAt !== null && !this.bossSpawned && t >= this.bossAt) {
      this.bossSpawned = true;
      ev.push({ type: 'boss', enemy: b.enemy });
    }
    const pace = pacingAt(st, t);
    if (pace !== this.lastPacing) {
      this.lastPacing = pace;
      if (pace?.label) ev.push({ type: 'pacing', label: pace.label, mult: pace.mult });
    }
    return ev;
  }
}
