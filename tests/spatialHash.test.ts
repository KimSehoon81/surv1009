import { describe, expect, it } from 'vitest';
import { SpatialHash } from '../src/core/spatialHash';
import { createRng } from '../src/core/rng';

describe('SpatialHash', () => {
  const rng = createRng(1);
  const pts = Array.from({ length: 500 }, (_, i) => ({ id: i, x: rng.range(-2000, 2000), y: rng.range(-2000, 2000) }));
  const h = new SpatialHash<(typeof pts)[number]>(64);
  for (const p of pts) h.insert(p);

  it('반경 질의 결과가 전수 조사와 같다(음수 좌표·칸 경계 포함)', () => {
    for (const [x, y, r] of [[0, 0, 100], [-500, 300, 250], [1999, -1999, 64], [10, 10, 0.5]] as const) {
      const got = h.queryRadius(x, y, r).map((p) => p.id).sort((a, b) => a - b);
      const want = pts.filter((p) => Math.hypot(p.x - x, p.y - y) <= r).map((p) => p.id).sort((a, b) => a - b);
      expect(got).toEqual(want);
    }
  });

  it('최근접은 전수 조사와 같고, 조건을 만족하는 것만, 범위 밖이면 null', () => {
    const want = [...pts].sort((a, b) => Math.hypot(a.x - 100, a.y - 100) - Math.hypot(b.x - 100, b.y - 100))[0];
    expect(h.nearest(100, 100, 5000)?.id).toBe(want?.id);
    const odd = h.nearest(100, 100, 5000, (p) => p.id % 2 === 1);
    expect((odd?.id ?? 0) % 2).toBe(1);
    expect(h.nearest(1e6, 1e6, 10)).toBeNull();
  });

  it('clear 후에는 비어 있고 다시 채울 수 있다', () => {
    const g = new SpatialHash<{ x: number; y: number }>(64);
    g.insert({ x: 1, y: 1 });
    g.clear();
    expect(g.queryRadius(0, 0, 100)).toEqual([]);
    g.insert({ x: 2, y: 2 });
    expect(g.queryRadius(0, 0, 100)).toHaveLength(1);
  });

  it('forEachNear는 true를 돌려주면 즉시 멈춘다', () => {
    let n = 0;
    h.forEachNear(0, 0, 3000, () => ++n >= 5);
    expect(n).toBe(5);
  });
});
