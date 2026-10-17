// 적 공격 2층(PRD §7.4 v0.2): 이동은 behaviors 부품(방향 합산), 공격은 이 단계 상태기계 위에 공격 부품을 얹는다.
// 단계: idle → windup(준비 동작) → telegraph(붉은 예고) → active(실행) → recover(회복) → idle(쿨다운).
// 플레이어를 해치는 공격은 예고를 최소 minTelegraphMs(0.6초) 보장한다. Phaser 없음(테스트 대상).
// 300체 기준 할당을 줄이려고 상태는 제자리에서 바꾼다(이벤트 배열만 새로 만든다).
// 보스·엘리트 패턴 시퀀서: weight가 있는 공격들은 준비된 것 중 가중치로 고른다(없으면 앞에서부터).

import { pityChance, pseudoRandomC } from './cardChance';

export type AttackPhase = 'idle' | 'windup' | 'telegraph' | 'active' | 'recover';

export interface AttackSpec {
  type: string;
  /** 시작 사거리 [최소, 최대] px(guard는 쓰지 않음) */
  range?: readonly number[];
  cooldownMs: number;
  windupMs?: number;
  telegraphMs?: number;
  activeMs: number;
  recoverMs: number;
  /** 피해 = 적 공격력 × damage */
  damage?: number;
  /** lob: 착탄 반경 px, 비행 시간 */
  radius?: number;
  flightMs?: number;
  /** guard: 받는 피해 감소 비율(0.6 = −60%), 회복 단계(약점 노출) 받는 피해 배율, 최근 이 시간 안에 맞았을 때만 */
  reduce?: number;
  weakMult?: number;
  whenHurtMs?: number;
  /** chargeDash: 돌진 속도 px/초, 예고선 폭 */
  speed?: number;
  width?: number;
  /** 패턴 시퀀서 가중치 */
  weight?: number;
  /** lob: 포탄 수(목표 + 둘레 고리), 고리 반지름 px */
  count?: number;
  spread?: number;
  /** fanShot: 사거리 px, 부채꼴 각도 */
  angleDeg?: number;
  /** opCard(보스 작전 카드): windup = 충전, 성공 확률(카드와 같은 연속 실패 완충), 충전 중 최대 체력의 이 비율만큼 맞으면 취소, 실패·취소 경직 시간 */
  chance?: number;
  cancelFrac?: number;
  failRecoverMs?: number;
}

export interface AttackState {
  phase: AttackPhase;
  /** 진행 중인 공격 번호(idle이면 -1) */
  index: number;
  phaseLeftMs: number;
  /** 공격별 남은 쿨다운 */
  cooldowns: number[];
  /** 예고 시작 때 고정한 목표 지점과 방향 */
  tx: number;
  ty: number;
  dirX: number;
  dirY: number;
  /** opCard: 충전 중 받은 피해(최대 체력 비율), 판정 실패·취소 여부, 연속 실패 수 */
  chargeDamage: number;
  failed: boolean;
  opFails: number;
}

export interface AttackCtx {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  /** 마지막으로 맞은 뒤 지난 시간(ms) */
  sinceHurtMs: number;
  /** 0~1 난수(패턴 가중치·작전 카드 판정). 없으면 첫 준비 공격·판정 실패 */
  rand?: () => number;
}

export type AttackEvent =
  | { type: 'windup' | 'telegraph' | 'active' | 'recover' | 'end'; index: number }
  /** opCard 충전 결과: success면 예고 → 대형 패턴, fail·cancel이면 경직·약점 */
  | { type: 'judged'; index: number; result: 'success' | 'fail' | 'cancel'; chance: number };

/** 이동 방식: free=행동 부품대로, hold=제자리, dash=고정 방향 돌진 */
export type MoveMode = 'free' | 'hold' | 'dash';

interface AttackPart {
  /** 플레이어를 해치는 공격(예고 최소 시간 적용) */
  threat: boolean;
  ready(spec: AttackSpec, ctx: AttackCtx): boolean;
  move(phase: AttackPhase): MoveMode;
  /** 받는 피해 배율 */
  taken?(spec: AttackSpec, phase: AttackPhase, s: AttackState): number;
}

const inRange = (spec: AttackSpec, ctx: AttackCtx): boolean => {
  const [min = 0, max = Infinity] = spec.range ?? [];
  const d = Math.hypot(ctx.targetX - ctx.x, ctx.targetY - ctx.y);
  return d >= min && d <= max;
};

export const ATTACK_PARTS: Record<string, AttackPart> = {
  /** 곡사(박격포 등): 제자리에서 목표 지점에 포탄 */
  lob: { threat: true, ready: inRange, move: (ph) => (ph === 'idle' ? 'free' : 'hold') },
  /** 방어 자세: 맞으면 멈춰 피해 감소, 풀릴 때 약점 노출(엘리트·보스) */
  guard: {
    threat: false,
    ready: (spec, ctx) => ctx.sinceHurtMs <= (spec.whenHurtMs ?? Infinity),
    move: (ph) => (ph === 'active' ? 'hold' : 'free'),
    taken: (spec, ph) => (ph === 'active' ? 1 - (spec.reduce ?? 0) : ph === 'recover' ? (spec.weakMult ?? 1) : 1),
  },
  /** 부채꼴 사격: 제자리에서 예고 부채꼴 안을 한꺼번에(기관총반·보스) */
  fanShot: { threat: true, ready: inRange, move: (ph) => (ph === 'idle' ? 'free' : 'hold') },
  /** 보스 작전 카드: 충전(windup) → 30% 판정 → 성공 시 예고 후 대형 착탄, 실패·취소 시 경직·약점 */
  opCard: {
    threat: true,
    ready: inRange,
    move: (ph) => (ph === 'idle' ? 'free' : 'hold'),
    taken: (spec, ph, st) => (ph === 'recover' && st.failed ? (spec.weakMult ?? 1) : 1),
  },
  /** 차징 돌진: 예고선 뒤 고정 방향으로 빠르게 */
  chargeDash: {
    threat: true,
    ready: inRange,
    move: (ph) => (ph === 'idle' ? 'free' : ph === 'active' ? 'dash' : 'hold'),
  },
};

function part(spec: AttackSpec): AttackPart {
  const p = ATTACK_PARTS[spec.type];
  if (!p) throw new Error(`알 수 없는 공격 부품: ${spec.type}`);
  return p;
}

/** 공격은 시작 쿨다운을 개체마다 흩뜨려 같은 종류가 한꺼번에 쏘지 않게, 반응형(방어 자세)은 처음부터 준비 */
export function createAttackState(specs: readonly AttackSpec[], rand: () => number): AttackState {
  const cooldowns = specs.map((s) => (part(s).threat ? s.cooldownMs * (0.3 + 0.7 * rand()) : 0));
  return { phase: 'idle', index: -1, phaseLeftMs: 0, cooldowns, tx: 0, ty: 0, dirX: 1, dirY: 0, chargeDamage: 0, failed: false, opFails: 0 };
}

export function phaseMs(spec: AttackSpec, phase: AttackPhase, minTelegraphMs: number): number {
  switch (phase) {
    case 'windup':
      return spec.windupMs ?? 0;
    case 'telegraph':
      return part(spec).threat ? Math.max(minTelegraphMs, spec.telegraphMs ?? 0) : (spec.telegraphMs ?? 0);
    case 'active':
      return spec.activeMs;
    case 'recover':
      return spec.recoverMs;
    default:
      return 0;
  }
}

const NEXT: Record<AttackPhase, AttackPhase> = { idle: 'windup', windup: 'telegraph', telegraph: 'active', active: 'recover', recover: 'idle' };

/** dtMs만큼 진행. 들어선 단계마다 이벤트 */
export function stepAttack(s: AttackState, specs: readonly AttackSpec[], dtMs: number, ctx: AttackCtx, minTelegraphMs: number): AttackEvent[] {
  const events: AttackEvent[] = [];
  if (specs.length === 0) return events;
  if (s.phase === 'idle') {
    for (let i = 0; i < s.cooldowns.length; i++) s.cooldowns[i] = Math.max(0, (s.cooldowns[i] ?? 0) - dtMs);
    const i = pick(specs, s, ctx);
    if (i < 0) return events;
    s.index = i;
    s.phase = 'windup';
    s.phaseLeftMs = phaseMs(specs[i] as AttackSpec, 'windup', minTelegraphMs);
    s.chargeDamage = 0;
    s.failed = false;
    events.push({ type: 'windup', index: i });
    dtMs = 0;
  }
  const spec = specs[s.index] as AttackSpec;
  s.phaseLeftMs -= dtMs;
  // 작전 카드 충전 중 피해 누적 → 취소(경직·약점)
  if (spec.type === 'opCard' && s.phase === 'windup' && s.chargeDamage >= (spec.cancelFrac ?? Infinity)) {
    failCard(s, spec, 'cancel', 0, events);
    return events;
  }
  // 길이 0인 단계는 같은 프레임에 건너뛴다
  while (s.phase !== 'idle' && s.phaseLeftMs <= 0) {
    const carry = s.phaseLeftMs;
    if (spec.type === 'opCard' && s.phase === 'windup') {
      // 충전 끝: 카드와 같은 30% 판정(연속 실패 완충)
      const chance = pityChance(pseudoRandomC(spec.chance ?? 0.3), s.opFails + 1);
      if ((ctx.rand?.() ?? 1) >= chance) {
        failCard(s, spec, 'fail', chance, events);
        break;
      }
      s.opFails = 0;
      events.push({ type: 'judged', index: s.index, result: 'success', chance });
    }
    if (s.phase === 'recover' && s.failed) s.failed = false;
    const next: AttackPhase = NEXT[s.phase];
    s.phase = next;
    if (next === 'telegraph') {
      // 목표를 이 순간에 고정(예고와 실제 공격 위치가 같게)
      s.tx = ctx.targetX;
      s.ty = ctx.targetY;
      const dx = ctx.targetX - ctx.x;
      const dy = ctx.targetY - ctx.y;
      const len = Math.hypot(dx, dy) || 1;
      s.dirX = dx / len;
      s.dirY = dy / len;
    }
    if (next === 'idle') {
      s.cooldowns[s.index] = spec.cooldownMs;
      events.push({ type: 'end', index: s.index });
      s.index = -1;
      break;
    }
    events.push({ type: next, index: s.index });
    s.phaseLeftMs = phaseMs(spec, next, minTelegraphMs) + carry;
  }
  return events;
}

/** 패턴 고르기: 준비된 공격 중 weight가 있으면 가중치, 없으면 앞에서부터 */
function pick(specs: readonly AttackSpec[], s: AttackState, ctx: AttackCtx): number {
  let total = 0;
  let first = -1;
  for (let k = 0; k < specs.length; k++) {
    const spec = specs[k] as AttackSpec;
    if ((s.cooldowns[k] ?? 0) > 0 || !part(spec).ready(spec, ctx)) continue;
    if (first < 0) first = k;
    total += spec.weight ?? 0;
  }
  if (first < 0 || total <= 0 || !ctx.rand) return first;
  let r = ctx.rand() * total;
  for (let k = 0; k < specs.length; k++) {
    const spec = specs[k] as AttackSpec;
    if ((s.cooldowns[k] ?? 0) > 0 || !part(spec).ready(spec, ctx)) continue;
    r -= spec.weight ?? 0;
    if (r < 0) return k;
  }
  return first;
}

/** 작전 카드 실패·취소: 예고·실행을 건너뛰고 경직(회복 단계 = 약점 노출) */
function failCard(s: AttackState, spec: AttackSpec, result: 'fail' | 'cancel', chance: number, events: AttackEvent[]): void {
  s.opFails++;
  s.failed = true;
  s.phase = 'recover';
  s.phaseLeftMs = spec.failRecoverMs ?? spec.recoverMs;
  events.push({ type: 'judged', index: s.index, result, chance });
  events.push({ type: 'recover', index: s.index });
}

export function moveMode(s: AttackState, specs: readonly AttackSpec[]): MoveMode {
  if (s.index < 0) return 'free';
  const spec = specs[s.index];
  return spec ? part(spec).move(s.phase) : 'free';
}

/** 받는 피해 배율(방어 자세 0.4, 약점 노출 1.5 등) */
export function damageTakenMult(s: AttackState, specs: readonly AttackSpec[]): number {
  if (s.index < 0) return 1;
  const spec = specs[s.index];
  return spec ? (part(spec).taken?.(spec, s.phase, s) ?? 1) : 1;
}
