// 게임패드(PRD §3 조작 표). 표준 매핑의 버튼·축 스냅숏 → 액션 이름. Phaser·브라우저 없음(테스트 대상).
// 버튼 이름: A B X Y LB RB LT RT View Start LS RS DUp DDown DLeft DRight(표준 매핑 0~15),
// 스틱 방향을 버튼처럼: LSUp LSDown LSLeft LSRight RSUp RSDown RSLeft RSRight.
// "Y:hold"처럼 :hold를 붙이면 holdMs 이상 누르고 있을 때 한 번(인장 제출 = Y 길게).

import { normalizeAxis, type Vec2 } from './movement';

export const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Start', 'LS', 'RS', 'DUp', 'DDown', 'DLeft', 'DRight'] as const;

export interface PadSnapshot {
  /** 버튼 눌림 정도 0~1(트리거는 아날로그) */
  readonly buttons: readonly number[];
  /** 축 −1~1: 0·1 왼쪽 스틱, 2·3 오른쪽 스틱 */
  readonly axes: readonly number[];
}

export interface PadConfig {
  /** 스틱 원형 데드존(이 안은 0, 밖은 0~1로 다시 늘림) */
  deadzone: number;
  /** 버튼·트리거가 눌렸다고 보는 값 */
  press: number;
  /** 스틱을 방향 버튼으로 볼 때 기울기 */
  stickButton: number;
  holdMs: number;
  /** 방향 입력 길게 누르면 반복(메뉴·카드 커서) */
  repeatDelayMs: number;
  repeatMs: number;
}

export interface PadState {
  down: ReadonlySet<string>;
  since: ReadonlyMap<string, number>;
  /** 반복·길게 누름을 마지막으로 낸 시각 */
  fired: ReadonlyMap<string, number>;
}

export const createPadState = (): PadState => ({ down: new Set(), since: new Map(), fired: new Map() });

/** 이미 누르고 있는 버튼은 새 눌림·반복·길게로 치지 않는 시작 상태(장면이 바뀔 때 누른 채였던 A가 다음 화면에서 또 눌리지 않게) */
export function heldPadState(snap: PadSnapshot | null, cfg: PadConfig, nowMs: number): PadState {
  if (!snap) return createPadState();
  const down = padNames(snap, cfg);
  // 반복 시각을 무한대로: 한 번 떼기 전까지는 반복도 길게도 없음
  return { down, since: new Map([...down].map((n) => [n, nowMs] as const)), fired: new Map([...down].map((n) => [n, Infinity] as const)) };
}

const REPEATS = new Set(['DUp', 'DDown', 'DLeft', 'DRight', 'LSUp', 'LSDown', 'LSLeft', 'LSRight', 'RSUp', 'RSDown', 'RSLeft', 'RSRight']);

/** 지금 눌린 가상 버튼 이름들 */
export function padNames(snap: PadSnapshot, cfg: PadConfig): Set<string> {
  const out = new Set<string>();
  PAD_BUTTONS.forEach((n, i) => {
    if ((snap.buttons[i] ?? 0) >= cfg.press) out.add(n);
  });
  const stick = (prefix: string, x: number, y: number) => {
    if (x <= -cfg.stickButton) out.add(`${prefix}Left`);
    if (x >= cfg.stickButton) out.add(`${prefix}Right`);
    if (y <= -cfg.stickButton) out.add(`${prefix}Up`);
    if (y >= cfg.stickButton) out.add(`${prefix}Down`);
  };
  stick('LS', snap.axes[0] ?? 0, snap.axes[1] ?? 0);
  stick('RS', snap.axes[2] ?? 0, snap.axes[3] ?? 0);
  return out;
}

/** 왼쪽 스틱 이동(원형 데드존, 바깥은 0~1로 다시 늘리고 길이 1 이하) */
export function padMove(snap: PadSnapshot, cfg: PadConfig): Vec2 {
  const x = snap.axes[0] ?? 0;
  const y = snap.axes[1] ?? 0;
  const mag = Math.hypot(x, y);
  if (mag < cfg.deadzone) return { x: 0, y: 0 };
  const k = Math.min(1, (mag - cfg.deadzone) / (1 - cfg.deadzone)) / mag;
  const v = { x: x * k, y: y * k };
  return Math.hypot(v.x, v.y) > 1 ? normalizeAxis(v.x, v.y) : v;
}

export interface PadStep {
  state: PadState;
  /** 이번에 새로 눌린 액션(반복·길게 누름 포함) */
  pressed: string[];
  /** 지금 누르고 있는 액션 */
  held: string[];
  /** 아무 버튼·스틱이라도 새로 움직였는지(마지막 입력 장치 표시용) */
  active: boolean;
}

/** 스냅숏 하나 진행: binding = 액션 → 가상 버튼 이름(":hold" 가능) */
export function stepPad(prev: PadState, snap: PadSnapshot, nowMs: number, binding: Readonly<Record<string, readonly string[]>>, cfg: PadConfig): PadStep {
  const cur = padNames(snap, cfg);
  const since = new Map<string, number>();
  const fired = new Map<string, number>();
  const edges = new Set<string>();
  for (const n of cur) {
    const s = prev.down.has(n) ? (prev.since.get(n) ?? nowMs) : nowMs;
    since.set(n, s);
    if (!prev.down.has(n)) {
      edges.add(n);
      continue;
    }
    // 방향은 길게 누르면 반복, 그 밖은 :hold 한 번
    const last = prev.fired.get(n);
    if (REPEATS.has(n)) {
      const due = last === undefined ? s + cfg.repeatDelayMs : last + cfg.repeatMs;
      if (nowMs >= due) {
        edges.add(n);
        fired.set(n, nowMs);
      } else if (last !== undefined) fired.set(n, last);
    } else if (last === undefined && nowMs - s >= cfg.holdMs) {
      edges.add(`${n}:hold`);
      fired.set(n, nowMs);
    } else if (last !== undefined) fired.set(n, last);
  }
  const pressed: string[] = [];
  const held: string[] = [];
  for (const [action, names] of Object.entries(binding)) {
    if (names.some((n) => edges.has(n))) pressed.push(action);
    if (names.some((n) => !n.endsWith(':hold') && cur.has(n))) held.push(action);
  }
  return { state: { down: cur, since, fired }, pressed, held, active: [...edges].some((n) => !n.endsWith(':hold')) };
}
