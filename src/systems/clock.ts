// 전투 시계. 전투 로직(이동·스폰·쿨다운·타임라인)은 Phaser의 delta 대신 이 시계의 tick() 결과만 쓴다.
// 일시정지·레벨업 정지·히트스톱·카드 판정 슬로모(0.3배)·보스 처치 슬로모가 모두 여기서 합성되어야
// 서로 덮어쓰거나 풀어버리는 충돌이 생기지 않는다. Phaser 의존 없음(테스트 가능).

export const FRAME_MS = 1000 / 60;

/** 탭 전환 등으로 delta가 튀어도 한 번에 진행되는 최대 실시간(ms) */
export const MAX_REAL_DELTA_MS = 100;

interface ScaleEntry {
  scale: number;
  /** 남은 실시간(ms). Infinity면 명시적으로 해제할 때까지 유지 */
  remainingMs: number;
}

export interface ClockSnapshot {
  /** 이번 tick에 적용된 배율 (0이면 정지) */
  scale: number;
  /** 누적 전투 시간(ms, 배율 적용) */
  timeMs: number;
  hitstopMs: number;
  modifiers: Record<string, number>;
}

export class GameClock {
  private readonly modifiers = new Map<string, ScaleEntry>();
  private hitstopRemainingMs = 0;
  private elapsedMs = 0;
  private lastScale = 1;

  /** 이름 붙은 배율 적용. 여러 개가 동시에 있으면 가장 느린 값(최솟값)이 이긴다 */
  setScale(key: string, scale: number, durationMs = Infinity): void {
    if (!(scale >= 0)) throw new Error(`clock.setScale: 잘못된 배율 ${scale}`);
    if (durationMs <= 0) {
      this.modifiers.delete(key);
      return;
    }
    this.modifiers.set(key, { scale, remainingMs: durationMs });
  }

  clearScale(key: string): void {
    this.modifiers.delete(key);
  }

  hasScale(key: string): boolean {
    return this.modifiers.has(key);
  }

  /** 일시정지(Esc)·레벨업 선택 등. 같은 key로 resume 해야 풀린다 */
  pause(key = 'pause'): void {
    this.setScale(key, 0);
  }

  resume(key = 'pause'): void {
    this.clearScale(key);
  }

  /**
   * 히트스톱: n프레임(60fps 기준) 동안 정지. 중첩하지 않고 남은 시간과 비교해 큰 쪽만 유지한다(PRD §4.4 성능 가드).
   */
  hitstop(frames: number): void {
    const ms = Math.max(0, frames) * FRAME_MS;
    if (ms > this.hitstopRemainingMs) this.hitstopRemainingMs = ms;
  }

  /** 현재 배율 (tick 전 미리보기) */
  get scale(): number {
    if (this.hitstopRemainingMs > 0) return 0;
    let s = 1;
    for (const entry of this.modifiers.values()) if (entry.scale < s) s = entry.scale;
    return s;
  }

  /** 누적 전투 시간(ms) */
  get timeMs(): number {
    return this.elapsedMs;
  }

  /**
   * 실시간 delta를 받아 배율 적용 delta를 돌려준다. 지속시간은 실시간 기준으로 줄어든다
   * (슬로모 0.6초는 화면상 0.6초여야 연출 타이밍이 맞는다).
   */
  tick(realDeltaMs: number): number {
    const real = Math.min(Math.max(0, realDeltaMs), MAX_REAL_DELTA_MS);

    // 히트스톱이 프레임 중간에 끝나면 남은 실시간은 정상 배율로 흐르게 나눈다
    const stopMs = Math.min(this.hitstopRemainingMs, real);
    this.hitstopRemainingMs -= stopMs;
    const flowingMs = real - stopMs;

    let s = 1;
    for (const entry of this.modifiers.values()) if (entry.scale < s) s = entry.scale;
    const scaled = flowingMs * s;
    this.lastScale = stopMs > 0 && flowingMs === 0 ? 0 : s;

    for (const [key, entry] of this.modifiers) {
      if (entry.remainingMs === Infinity) continue;
      entry.remainingMs -= real;
      if (entry.remainingMs <= 0) this.modifiers.delete(key);
    }

    this.elapsedMs += scaled;
    return scaled;
  }

  snapshot(): ClockSnapshot {
    const modifiers: Record<string, number> = {};
    for (const [key, entry] of this.modifiers) modifiers[key] = entry.scale;
    return {
      scale: this.lastScale,
      timeMs: this.elapsedMs,
      hitstopMs: this.hitstopRemainingMs,
      modifiers,
    };
  }

  /** 새 판 시작 */
  reset(): void {
    this.modifiers.clear();
    this.hitstopRemainingMs = 0;
    this.elapsedMs = 0;
    this.lastScale = 1;
  }
}
