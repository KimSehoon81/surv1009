// 작전지도 투영(위경도 → 화면). 정거원통 + 위도 38° 경도 축척(cos). Phaser 없음(테스트 대상)

export type LonLat = readonly [number, number];

export interface Projection {
  /** 화면 왼쪽 위에 오는 경도·위도 */
  lon0: number;
  lat0: number;
  /** 위도 1°당 화면 px */
  scale: number;
  x0: number;
  y0: number;
}

const LON_K = Math.cos((38 * Math.PI) / 180);

export function project(p: Projection, lon: number, lat: number): { x: number; y: number } {
  return { x: p.x0 + (lon - p.lon0) * LON_K * p.scale, y: p.y0 + (p.lat0 - lat) * p.scale };
}

/** 다각형 안에 점이 있는지(짝홀 규칙) */
export function inside(poly: readonly LonLat[], lon: number, lat: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi = 0, yi = 0] = poly[i] ?? [];
    const [xj = 0, yj = 0] = poly[j] ?? [];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
