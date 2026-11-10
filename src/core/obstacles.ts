// 정적 장애물(PRD §7.4 S5~6 "장애물 설치", D32): 축 정렬 사각형 충돌체. 길찾기 없이 원을 밖으로 밀어내고(법선) 벽을 따라 미끄러진다.
// 직선 투사체·조준 사격은 막히고, 곡사·항공은 통과(호출부가 고름). Phaser 없음(테스트 대상).
import { createRng } from './rng';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 부서지는 장애물(바리케이드)의 남은 체력, 없으면 부서지지 않음 */
  hp?: number;
  /** 사라지는 시각(전투 시계 ms), 없으면 영구 */
  untilMs?: number;
}

/** 원(cx, cy, r)이 사각형과 겹치면 밖으로 미는 벡터와 바깥 법선, 아니면 null */
export function pushOut(cx: number, cy: number, r: number, b: Rect): { dx: number; dy: number; nx: number; ny: number } | null {
  const px = Math.max(b.x, Math.min(cx, b.x + b.w));
  const py = Math.max(b.y, Math.min(cy, b.y + b.h));
  const ox = cx - px;
  const oy = cy - py;
  const d2 = ox * ox + oy * oy;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { dx: (ox / d) * (r - d), dy: (oy / d) * (r - d), nx: ox / d, ny: oy / d };
  }
  // 중심이 사각형 안: 가장 가까운 변으로
  const left = cx - b.x;
  const right = b.x + b.w - cx;
  const top = cy - b.y;
  const bottom = b.y + b.h - cy;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { dx: -(left + r), dy: 0, nx: -1, ny: 0 };
  if (m === right) return { dx: right + r, dy: 0, nx: 1, ny: 0 };
  if (m === top) return { dx: 0, dy: -(top + r), nx: 0, ny: -1 };
  return { dx: 0, dy: bottom + r, nx: 0, ny: 1 };
}

/** 여러 사각형에서 밀어낸 위치와 마지막으로 닿은 법선(없으면 0) */
export function resolveCircle(cx: number, cy: number, r: number, rects: readonly Rect[]): { x: number; y: number; nx: number; ny: number } {
  let x = cx;
  let y = cy;
  let nx = 0;
  let ny = 0;
  // 모서리 두 개에 끼는 경우를 위해 두 번
  for (let pass = 0; pass < 2; pass++) {
    for (const b of rects) {
      const p = pushOut(x, y, r, b);
      if (!p) continue;
      x += p.dx;
      y += p.dy;
      nx = p.nx;
      ny = p.ny;
    }
  }
  return { x, y, nx, ny };
}

/**
 * 벽 따라 미끄러지기: 원하던 방향(dirX, dirY)에서 법선 성분을 빼고 남은 접선 방향(목표 쪽 부호).
 * 정면으로 막혔으면(접선 성분 ≈ 0) 목표 쪽 접선으로 돌아간다.
 */
export function slideDir(dirX: number, dirY: number, nx: number, ny: number, toX: number, toY: number): { x: number; y: number } {
  const into = dirX * nx + dirY * ny;
  if (into >= 0) return { x: dirX, y: dirY };
  let tx = dirX - into * nx;
  let ty = dirY - into * ny;
  const tl = Math.hypot(tx, ty);
  if (tl < 0.2) {
    // 정면: 목표 쪽 접선
    tx = -ny;
    ty = nx;
    if (tx * toX + ty * toY < 0) {
      tx = -tx;
      ty = -ty;
    }
    return { x: tx, y: ty };
  }
  return { x: tx / tl, y: ty / tl };
}

/** 선분이 사각형을 지나는지(조준 사격·직선 탄 차단) */
export function segmentHitsRect(x0: number, y0: number, x1: number, y1: number, b: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, x0 - b.x) && clip(dx, b.x + b.w - x0) && clip(-dy, y0 - b.y) && clip(dy, b.y + b.h - y0) && t0 <= t1;
}

export function pointInRect(x: number, y: number, b: Rect): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export interface ObstacleLayout {
  /** 청크(정사각형 chunkPx)당 개수 [최소, 최대] */
  perChunk: readonly number[];
  w: readonly number[];
  h: readonly number[];
  /** 원점(출정 자리) 반경 안은 비움 */
  clear: number;
  /** 장애물 사이 최소 틈(px) — 끼어 갇히지 않게 */
  gap: number;
}

/** 청크(cx, cy)의 장애물: 같은 시드·청크면 늘 같은 배치(바닥 무늬처럼 스트리밍) */
export function chunkObstacles(cx: number, cy: number, chunkPx: number, L: ObstacleLayout, seed: string): Rect[] {
  const rng = createRng(`${seed}:obs:${cx},${cy}`);
  const [lo = 0, hi = lo] = L.perChunk;
  const n = lo + Math.floor(rng.next() * (hi - lo + 1));
  const out: Rect[] = [];
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const w = L.w[0]! + rng.next() * ((L.w[1] ?? L.w[0]!) - L.w[0]!);
    const h = L.h[0]! + rng.next() * ((L.h[1] ?? L.h[0]!) - L.h[0]!);
    const x = cx * chunkPx + rng.next() * (chunkPx - w);
    const y = cy * chunkPx + rng.next() * (chunkPx - h);
    const r: Rect = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    // 원점 근처 비움, 서로 gap 이상 떨어짐
    if (pushOut(0, 0, L.clear, r)) continue;
    if (out.some((o) => r.x < o.x + o.w + L.gap && o.x < r.x + r.w + L.gap && r.y < o.y + o.h + L.gap && o.y < r.y + r.h + L.gap)) continue;
    out.push(r);
  }
  return out;
}
