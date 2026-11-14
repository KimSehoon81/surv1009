// 질주(2026-11-14): 키 한 번에 짧게 빨리 달리고(처음 잠깐 무적) 재사용 대기. Phaser 없음(테스트 대상)

export interface SprintConfig {
  durationMs: number;
  speedMul: number;
  cooldownMs: number;
  /** 시작부터 이 시간 무적(포위 뚫기) */
  invulnMs: number;
  /** 끝 이 시간 동안 원래 속도로 부드럽게 돌아옴 */
  easeOutMs: number;
}

export interface SprintState {
  startedAtMs: number;
  readyAtMs: number;
}

export const createSprint = (): SprintState => ({ startedAtMs: -Infinity, readyAtMs: 0 });

export function trySprint(s: SprintState, nowMs: number, cfg: SprintConfig): { state: SprintState; ok: boolean } {
  if (nowMs < s.readyAtMs) return { state: s, ok: false };
  return { state: { startedAtMs: nowMs, readyAtMs: nowMs + cfg.cooldownMs }, ok: true };
}

export const sprinting = (s: SprintState, nowMs: number, cfg: SprintConfig): boolean => nowMs >= s.startedAtMs && nowMs < s.startedAtMs + cfg.durationMs;

/** 지금 이동 속도 배율(질주 중이 아니면 1, 끝에서 부드럽게 1로) */
export function sprintMul(s: SprintState, nowMs: number, cfg: SprintConfig): number {
  if (!sprinting(s, nowMs, cfg)) return 1;
  const left = s.startedAtMs + cfg.durationMs - nowMs;
  const k = cfg.easeOutMs > 0 ? Math.min(1, left / cfg.easeOutMs) : 1;
  return 1 + (cfg.speedMul - 1) * k;
}

/** 다시 쓸 수 있을 때까지 0~1(1 = 준비됨) */
export const sprintReady = (s: SprintState, nowMs: number, cfg: SprintConfig): number => (nowMs >= s.readyAtMs ? 1 : 1 - (s.readyAtMs - nowMs) / cfg.cooldownMs);
