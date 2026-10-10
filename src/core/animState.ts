// 유닛 동작 상태 머신(PRD §4.3). Phaser 없이 "지금 어떤 동작을 재생해야 하는가"만 결정한다.
// - 이동 동작(정지/느림/빠름)은 매 프레임 이동 상태로 정해진다
// - 한 번 재생 동작(공격·방어·스킬·치명타 등)은 트리거되면 재생 시간 동안 이동 동작보다 우선한다
// - 한 번 재생 동작끼리는 priority가 높은 쪽이 낮은 쪽을 끊고, 낮은 쪽은 높은 쪽 재생 중에 무시된다

export interface ActionRule {
  fps: number;
  loop: boolean;
  /** 한 번 재생 동작의 최소 재생 시간(ms). 프레임 수가 적어도 이 시간은 유지 */
  minMs?: number;
}

export interface AnimRules {
  actions: Record<string, ActionRule>;
  /** 높은 것부터 */
  priority: string[];
  /** 이동 속도 배율이 이 값 미만이면 느린 이동 */
  slowThreshold: number;
  locomotion: { idle: string; slow: string; fast: string };
}

export interface AnimState {
  /** 지금 재생할 동작 */
  current: string;
  /** current가 시작된 시각(ms). 같은 동작을 다시 시작했는지 판별용 */
  startedMs: number;
  /** 재생 중인 한 번 재생 동작(없으면 null) */
  oneShot: string | null;
  oneShotEndMs: number;
}

export interface MoveInput {
  moving: boolean;
  /** 현재 이동 속도 / 기본 이동 속도 */
  speedRatio: number;
}

export function createAnimState(rules: AnimRules, nowMs = 0): AnimState {
  return { current: rules.locomotion.idle, startedMs: nowMs, oneShot: null, oneShotEndMs: 0 };
}

/** 한 번 재생 동작의 길이: 프레임 수/fps와 minMs 중 큰 값 */
export function oneShotDurationMs(rule: ActionRule, frames: number): number {
  return Math.max(rule.minMs ?? 0, (frames / rule.fps) * 1000);
}

export function locomotionFor(rules: AnimRules, move: MoveInput): string {
  if (!move.moving) return rules.locomotion.idle;
  return move.speedRatio < rules.slowThreshold ? rules.locomotion.slow : rules.locomotion.fast;
}

function rank(rules: AnimRules, action: string): number {
  const i = rules.priority.indexOf(action);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/** 한 번 재생 동작을 트리거한다. 반복 동작이나 모르는 동작은 무시 */
export function triggerAction(state: AnimState, rules: AnimRules, action: string, frames: number, nowMs: number): AnimState {
  const rule = rules.actions[action];
  if (!rule || rule.loop) return state;
  const active = state.oneShot !== null && nowMs < state.oneShotEndMs;
  if (active && rank(rules, action) > rank(rules, state.oneShot as string)) return state;
  return {
    current: action,
    startedMs: nowMs,
    oneShot: action,
    oneShotEndMs: nowMs + oneShotDurationMs(rule, frames),
  };
}

/** 매 프레임 호출: 한 번 재생 동작이 끝났으면 이동 동작으로 돌아간다 */
export function updateAnimState(state: AnimState, rules: AnimRules, move: MoveInput, nowMs: number): AnimState {
  if (state.oneShot !== null && nowMs < state.oneShotEndMs) return state;
  const loco = locomotionFor(rules, move);
  if (state.oneShot === null && state.current === loco) return state;
  return { current: loco, startedMs: state.current === loco ? state.startedMs : nowMs, oneShot: null, oneShotEndMs: 0 };
}
