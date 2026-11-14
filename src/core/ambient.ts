// 주변 생활(소·호랑이·개·주민, 2026-11-14): 나타날 자리·거닐기·폭발에서 떠나기. Phaser 없음
import type { Rng } from './rng';

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AmbientCfg {
  spawnMargin: number;
  walkMs: number[];
  idleMs: number[];
  keepAway: number;
  fleeRadius: number;
  despawnBeyond: number;
}

const range = (rng: Rng, r: number[]): number => {
  const [lo = 0, hi = lo] = r;
  return lo + (hi - lo) * rng.next();
};

/** 화면 바로 바깥(가장자리 margin px 밖) 한 점과 화면 안쪽을 향한 걷기 방향 */
export function spawnPoint(rng: Rng, v: View, margin: number): { x: number; y: number; dirX: number; dirY: number } {
  const side = Math.floor(rng.next() * 4);
  const t = 0.15 + 0.7 * rng.next();
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  const p =
    side === 0
      ? { x: v.x - margin, y: v.y + v.h * t }
      : side === 1
        ? { x: v.x + v.w + margin, y: v.y + v.h * t }
        : side === 2
          ? { x: v.x + v.w * t, y: v.y - margin }
          : { x: v.x + v.w * t, y: v.y + v.h + margin };
  // 화면 가운데 쪽으로(살짝 비껴) 걸어 들어옴
  const a = Math.atan2(cy - p.y, cx - p.x) + (rng.next() - 0.5) * 0.9;
  return { ...p, dirX: Math.cos(a), dirY: Math.sin(a) };
}

/** 화면에서 m px 넘게 벗어났는지 */
export function outside(x: number, y: number, v: View, m: number): boolean {
  return x < v.x - m || x > v.x + v.w + m || y < v.y - m || y > v.y + v.h + m;
}

/** 다음 거닐기: 걷기(방향·시간) 또는 쉬기. 플레이어가 keepAway 안이면 멀어지는 쪽으로 걷는다 */
export function nextWander(
  rng: Rng,
  cfg: AmbientCfg,
  at: { x: number; y: number },
  player: { x: number; y: number },
): { mode: 'walk' | 'idle'; ms: number; dirX: number; dirY: number } {
  const dx = at.x - player.x;
  const dy = at.y - player.y;
  const d = Math.hypot(dx, dy);
  if (d < cfg.keepAway) return { mode: 'walk', ms: range(rng, cfg.walkMs), dirX: d > 0 ? dx / d : 1, dirY: d > 0 ? dy / d : 0 };
  if (rng.next() < 0.45) return { mode: 'idle', ms: range(rng, cfg.idleMs), dirX: 0, dirY: 0 };
  const a = rng.next() * Math.PI * 2;
  return { mode: 'walk', ms: range(rng, cfg.walkMs), dirX: Math.cos(a), dirY: Math.sin(a) * 0.6 };
}

/** 폭발(중심·반경)이 가까우면 떠날 방향(폭발 반대쪽), 멀면 null */
export function fleeDir(at: { x: number; y: number }, blast: { x: number; y: number; r: number }, cfg: AmbientCfg): { dirX: number; dirY: number } | null {
  const dx = at.x - blast.x;
  const dy = at.y - blast.y;
  const d = Math.hypot(dx, dy);
  if (d > cfg.fleeRadius + blast.r) return null;
  return d > 0.001 ? { dirX: dx / d, dirY: dy / d } : { dirX: 1, dirY: 0 };
}
