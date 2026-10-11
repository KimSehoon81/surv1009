// 타격감 계산(Phaser 없음). 연출 시스템(systems/feel.ts)은 여기서 나온 값을 그리기만 한다.

export const FRAME_MS = 1000 / 60;

/** 60fps 기준 프레임 수 → ms */
export function framesToMs(frames: number): number {
  return Math.max(0, frames) * FRAME_MS;
}

export function easeOutQuad(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return 1 - (1 - t) * (1 - t);
}

export function easeOutCubic(k: number): number {
  const t = Math.min(1, Math.max(0, k));
  return 1 - (1 - t) ** 3;
}

/** 넉백 진행 상태. 개체가 들고 있고 매 프레임 stepKnockback으로 이동량을 꺼낸다 */
export interface Knockback {
  dirX: number;
  dirY: number;
  px: number;
  ms: number;
  t: number;
}

export function createKnockback(): Knockback {
  return { dirX: 0, dirY: 0, px: 0, ms: 0, t: 0 };
}

/** 새 넉백 시작. 방향은 정규화한다(0 벡터면 넉백 없음). 진행 중인 넉백은 새 것으로 바뀐다 */
export function startKnockback(kb: Knockback, dirX: number, dirY: number, px: number, ms: number): void {
  const len = Math.hypot(dirX, dirY);
  if (len === 0 || px <= 0 || ms <= 0) return;
  kb.dirX = dirX / len;
  kb.dirY = dirY / len;
  kb.px = px;
  kb.ms = ms;
  kb.t = 0;
}

/** dt만큼 진행하고 이번 프레임 이동량을 돌려준다(이징아웃: 처음에 크게, 끝에 작게). 합계는 정확히 px */
export function stepKnockback(kb: Knockback, dtMs: number): { dx: number; dy: number } {
  if (kb.ms <= 0 || dtMs <= 0) return { dx: 0, dy: 0 };
  const k0 = kb.t / kb.ms;
  kb.t = Math.min(kb.ms, kb.t + dtMs);
  const k1 = kb.t / kb.ms;
  const d = (easeOutQuad(k1) - easeOutQuad(k0)) * kb.px;
  if (k1 >= 1) kb.ms = 0;
  return { dx: kb.dirX * d, dy: kb.dirY * d };
}

/** 흔들림 px → Phaser camera.shake 강도(뷰포트 비율). mul은 접근성 강도 배율 0~1 */
export function shakeIntensity(px: number, viewW: number, viewH: number, mul = 1): { x: number; y: number } {
  const p = Math.max(0, px) * Math.min(1, Math.max(0, mul));
  return { x: viewW > 0 ? p / viewW : 0, y: viewH > 0 ? p / viewH : 0 };
}

export interface NumberAnimConfig {
  jumpPx: number;
  popScale: number;
  popMs: number;
  fadeFromK: number;
}

/** 데미지 숫자: 위로 튀어 오르며(감속) 처음에 크게 떴다가 원래 크기로, 끝부분에서 사라진다 */
export function numberAnim(elapsedMs: number, lifeMs: number, cfg: NumberAnimConfig): { dy: number; alpha: number; scaleMul: number } {
  const k = lifeMs > 0 ? Math.min(1, Math.max(0, elapsedMs / lifeMs)) : 1;
  const dy = -cfg.jumpPx * easeOutCubic(k);
  const fade = cfg.fadeFromK >= 1 ? 0 : Math.max(0, (k - cfg.fadeFromK) / (1 - cfg.fadeFromK));
  const pop = cfg.popMs > 0 ? Math.min(1, elapsedMs / cfg.popMs) : 1;
  const scaleMul = 1 + (cfg.popScale - 1) * (1 - easeOutQuad(pop));
  return { dy, alpha: 1 - fade, scaleMul };
}

/** 수명 비율 k에서의 알파. fadeFromK 전까지는 시작값 유지 후 선형으로 끝값 */
export function fadeAlpha(k: number, from: number, to: number, fadeFromK = 0): number {
  const t = Math.min(1, Math.max(0, k));
  if (t <= fadeFromK) return from;
  const u = fadeFromK >= 1 ? 1 : (t - fadeFromK) / (1 - fadeFromK);
  return from + (to - from) * u;
}

/** 연속 처치 카운터: windowMs 안에 다음 처치가 오면 이어진다 */
export class Combo {
  count = 0;
  private lastMs = -Infinity;

  constructor(private readonly windowMs: number) {}

  add(nowMs: number): number {
    this.count = nowMs - this.lastMs <= this.windowMs ? this.count + 1 : 1;
    this.lastMs = nowMs;
    return this.count;
  }

  /** 창이 지났으면 0으로 되돌리고 true */
  expire(nowMs: number): boolean {
    if (this.count > 0 && nowMs - this.lastMs > this.windowMs) {
      this.count = 0;
      return true;
    }
    return false;
  }
}

/** "#rrggbb" → 0xrrggbb */
export function parseColor(hex: string): number {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(v)) throw new Error(`잘못된 색: ${hex}`);
  return v;
}

/** 줌 펀치 곡선: inMs 동안 0→1(이징아웃), outMs 동안 1→0. 범위 밖은 0 */
export function punchCurve(elapsedMs: number, inMs: number, outMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs < inMs) return easeOutQuad(elapsedMs / inMs);
  const t = elapsedMs - inMs;
  if (t >= outMs) return 0;
  return 1 - easeOutQuad(t / outMs);
}
