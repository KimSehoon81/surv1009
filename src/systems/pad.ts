// 브라우저 Gamepad API 읽기와 진동(D43). 표준 매핑 패드를 우선, 마지막으로 입력한 패드를 계속 쓴다.
import controls from '../data/controls.json';
import type { PadConfig, PadSnapshot } from '../core/pad';

export const PAD_CFG = controls.padConfig as PadConfig;
export const PAD_BIND = controls.pad as Readonly<Record<string, readonly string[]>>;

type Device = 'keyboard' | 'pad';
let device: Device = 'keyboard';
let padIndex = -1;

/** 마지막으로 입력한 장치(버튼 표시를 키보드·패드 중 무엇으로 할지) */
export const lastDevice = (): Device => device;
export function setDevice(d: Device): void {
  device = d;
}

function pads(): readonly (Gamepad | null)[] {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}

export function readPad(): PadSnapshot | null {
  const list = pads();
  let gp = padIndex >= 0 ? (list[padIndex] ?? null) : null;
  if (!gp?.connected) gp = list.find((g) => g?.connected && g.mapping === 'standard') ?? list.find((g) => g?.connected) ?? null;
  if (!gp) return null;
  padIndex = gp.index;
  return { buttons: gp.buttons.map((b) => b.value), axes: gp.axes };
}

type Actuator = { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> };

/** 진동: 패드로 놀고 있고 진동 장치가 있을 때만. 세기는 호출부가 흔들림 강도 설정을 곱해 넘긴다 */
export function rumble(ms: number, strong: number, weak: number): void {
  if (device !== 'pad' || padIndex < 0 || (strong <= 0 && weak <= 0)) return;
  const act = (pads()[padIndex] as (Gamepad & { vibrationActuator?: Actuator }) | null)?.vibrationActuator;
  if (!act?.playEffect) return;
  act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => undefined);
}
