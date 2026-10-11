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

/**
 * 히트스톱을 걸지 판정. 간격(minGapMs)이 없는 프리셋은 항상 건다(시계가 최댓값만 유지하므로 중첩 없음).
 * 간격이 있는 프리셋(연사용 일반 타격)은 직전 히트스톱이 끝난 뒤 minGapMs가 지나야 건다.
 */
export function hitstopAllowed(nowMs: number, lastEndMs: number, minGapMs?: number): boolean {
  if (!minGapMs) return true;
  return nowMs >= lastEndMs + minGapMs;
}

/** 진행 중인 줌(current)에서 더 큰 펀치(amount)로 이어 붙일 때, 곡선의 어느 시점에서 시작할지(ms). 출렁임 방지 */
export function punchRestartElapsed(current: number, amount: number, inMs: number): number {
  if (amount <= 0 || current <= 0) return 0;
  const r = Math.min(1, current / amount);
  return inMs * (1 - Math.sqrt(1 - r));
}

/**
 * 화면 흔들림 + 방향 킥(PRD §6.2 "착탄마다 흔들림 누적"). Phaser camera.shake는 약한 흔들림이 강한 흔들림을
 * 덮어쓰지 못해 누적이 안 되므로 직접 계산해 카메라 오프셋으로 준다. 오프셋은 정수 px(도트가 번지지 않게).
 */
export class Shaker {
  private readonly shakes: { px: number; start: number; ms: number; stack: boolean }[] = [];
  private kick: { x: number; y: number; px: number; start: number; ms: number } | null = null;

  /** capPx: 누적 흔들림 상한, maxEntries: 동시에 기억하는 흔들림 수 */
  constructor(
    private readonly capPx = 8,
    private readonly maxEntries = 8,
  ) {}

  /** stack=true(연속 착탄)끼리는 겹칠수록 커지고, false(일반 타격)는 가장 강한 하나만 반영 */
  addShake(px: number, ms: number, now: number, stack = false): void {
    if (px <= 0 || ms <= 0) return;
    this.prune(now);
    if (this.shakes.length >= this.maxEntries) {
      // 가장 약하게 남은 것을 뺀다
      let weakest = 0;
      let weakestAmp = Infinity;
      this.shakes.forEach((s, i) => {
        const a = s.px * (1 - (now - s.start) / s.ms);
        if (a < weakestAmp) {
          weakestAmp = a;
          weakest = i;
        }
      });
      this.shakes.splice(weakest, 1);
    }
    this.shakes.push({ px, start: now, ms, stack });
  }

  /** 맞은 방향으로 화면을 순간 밀었다가(px) ms 동안 되돌림 */
  addKick(dirX: number, dirY: number, px: number, ms: number, now: number): void {
    const len = Math.hypot(dirX, dirY);
    if (len === 0 || px <= 0 || ms <= 0) return;
    const current = this.kick ? this.kickPx(now) : 0;
    if (current > px) return;
    this.kick = { x: dirX / len, y: dirY / len, px, start: now, ms };
  }

  /** 현재 흔들림 진폭(px): 전체 중 가장 강한 것과, 누적형(stack)의 "가장 강한 것 + 나머지 합의 절반" 중 큰 값. capPx 상한 */
  amplitude(now: number): number {
    let maxAll = 0;
    let maxStack = 0;
    let sumStack = 0;
    for (const s of this.shakes) {
      const t = (now - s.start) / s.ms;
      if (t < 0 || t >= 1) continue;
      const a = s.px * (1 - t);
      if (a > maxAll) maxAll = a;
      if (s.stack) {
        sumStack += a;
        if (a > maxStack) maxStack = a;
      }
    }
    return Math.min(this.capPx, Math.max(maxAll, maxStack + (sumStack - maxStack) * 0.5));
  }

  private kickPx(now: number): number {
    if (!this.kick) return 0;
    const t = (now - this.kick.start) / this.kick.ms;
    if (t < 0 || t >= 1) return 0;
    return this.kick.px * (1 - t) * (1 - t);
  }

  /** 이번 프레임 카메라 오프셋(정수 px). rand: 0~1 난수, mul: 접근성 강도 0~1 */
  sample(now: number, rand: () => number, mul = 1): { x: number; y: number } {
    const m = Math.min(1, Math.max(0, mul));
    if (m === 0) return { x: 0, y: 0 };
    const a = this.amplitude(now) * m;
    const k = this.kickPx(now) * m;
    const kx = this.kick ? this.kick.x * k : 0;
    const ky = this.kick ? this.kick.y * k : 0;
    const x = Math.round(kx + (a > 0 ? (rand() * 2 - 1) * a : 0));
    const y = Math.round(ky + (a > 0 ? (rand() * 2 - 1) * a : 0));
    return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
  }

  private prune(now: number): void {
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      if (s && now - s.start >= s.ms) this.shakes.splice(i, 1);
    }
  }

  reset(): void {
    this.shakes.length = 0;
    this.kick = null;
  }
}

/**
 * 전역 정지 예산(새는 양동이): 길게 보면 정지 시간이 전체의 ratio 이하가 되게 한다.
 * capMs는 한 번에 몰아 쓸 수 있는 양.
 */
export class StopBudget {
  private level = 0;
  private last = -Infinity;

  constructor(
    private readonly ratio: number,
    private readonly capMs: number,
  ) {}

  /** ms만큼 정지해도 되면 기록하고 true. force(대형 처치 등)는 예산과 상관없이 허용하되 기록은 한다 */
  request(now: number, ms: number, force = false): boolean {
    // 경과 시간(정지 구간 포함)의 ratio만큼 비워진다 → 긴 구간에서 정지 비율이 ratio에 수렴
    if (this.last !== -Infinity) this.level = Math.max(0, this.level - (now - this.last) * this.ratio);
    this.last = now;
    if (!force && this.level + ms > this.capMs) return false;
    this.level += ms;
    return true;
  }
}

/** 이번 프레임에 "전체 연출"을 줄지: 우선순위가 alwaysFrom 이상이면 항상, 아니면 프레임당 budget개까지 */
export function lodAllows(usedThisFrame: number, budget: number, priority: number, alwaysFrom: number): boolean {
  return priority >= alwaysFrom || usedThisFrame < budget;
}
