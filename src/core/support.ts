// 전투 지원 기믹(보급 투하·우방군 분대)의 규칙. Phaser 없음(테스트 대상)
import type { Rng } from './rng';

export interface Weighted {
  id: string;
  weight: number;
}

/** 첫 시각 + 주기로 반복되는 일정: 마지막으로 낸 시각 이후 지금이 다음 차례면 그 시각 */
export function due(nowSec: number, firstSec: number, everySec: number, lastSec: number | null): number | null {
  const next = lastSec === null ? firstSec : lastSec + everySec;
  return nowSec >= next ? next : null;
}

export function pickWeighted<T extends Weighted>(rng: Rng, items: readonly T[]): T | null {
  const total = items.reduce((s, x) => s + Math.max(0, x.weight), 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const x of items) {
    r -= Math.max(0, x.weight);
    if (r < 0) return x;
  }
  return items[items.length - 1] ?? null;
}

/** 플레이어 둘레 분대 자리(i번째, n명): 플레이어가 바라보는 쪽 반원에 고르게 */
export function formationSlot(i: number, n: number, ring: number, facing: 1 | -1): { x: number; y: number } {
  const spread = Math.PI * 0.9;
  const a = (n <= 1 ? 0 : -spread / 2 + (spread * i) / (n - 1)) + (facing > 0 ? 0 : Math.PI);
  return { x: Math.cos(a) * ring, y: Math.sin(a) * ring * 0.7 };
}

/** 떨어질 자리: 플레이어에서 [lo, hi] 거리, 무작위 방향 */
export function dropPoint(rng: Rng, px: number, py: number, lo: number, hi: number): { x: number; y: number } {
  const a = rng.next() * Math.PI * 2;
  const r = lo + rng.next() * (hi - lo);
  return { x: px + Math.cos(a) * r, y: py + Math.sin(a) * r * 0.75 };
}
