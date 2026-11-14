import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import { inside, project, type LonLat, type Projection } from '../src/core/geo';

const P = mapData.projection as Projection;
const COAST = mapData.coast as unknown as LonLat[];

describe('작전지도 투영(2026-11-14)', () => {
  it('모든 지역은 한반도 안, 남→북 순서대로 대체로 위로', () => {
    for (const n of mapData.nodes) expect(inside(COAST, n.lon, n.lat), n.id).toBe(true);
    const first = mapData.nodes[0];
    const last = mapData.nodes[mapData.nodes.length - 1];
    expect(project(P, last?.lon ?? 0, last?.lat ?? 0).y).toBeLessThan(project(P, first?.lon ?? 0, first?.lat ?? 0).y);
  });

  it('지도는 화면 가운데 칸(글 상자와 안 겹침) 안에, 지역끼리 18px 이상 떨어짐', () => {
    const xs = COAST.map(([lon, lat]) => project(P, lon, lat));
    expect(Math.min(...xs.map((p) => p.x))).toBeGreaterThan(320);
    expect(Math.max(...xs.map((p) => p.x))).toBeLessThan(640);
    expect(Math.min(...xs.map((p) => p.y))).toBeGreaterThan(0);
    expect(Math.max(...xs.map((p) => p.y))).toBeLessThan(520);
    const pts = mapData.nodes.map((n) => project(P, n.lon, n.lat));
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot((pts[i]?.x ?? 0) - (pts[j]?.x ?? 0), (pts[i]?.y ?? 0) - (pts[j]?.y ?? 0)), `${i}-${j}`).toBeGreaterThan(18);
  });

  it('inside: 바다·대륙 점은 밖', () => {
    expect(inside(COAST, 130.5, 37.5)).toBe(false); // 동해
    expect(inside(COAST, 124.5, 37.0)).toBe(false); // 황해
    expect(inside(COAST, 127.5, 42.5)).toBe(false); // 만주
  });
});
