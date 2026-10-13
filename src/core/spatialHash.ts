// 공간 해시: 근접 탐색(조준·충돌·겹침 완화)을 화면 전체가 아니라 주변 칸만 보게 한다.
// 매 프레임 clear → insert로 다시 채운다(300~1000개 기준 가장 단순하고 빠름). 칸 배열은 재사용해 GC를 만들지 않는다.

export interface Point {
  x: number;
  y: number;
}

export class SpatialHash<T extends Point> {
  private readonly buckets = new Map<number, T[]>();
  private readonly used: T[][] = [];

  constructor(readonly cellSize = 64) {}

  private key(cx: number, cy: number): number {
    // ±32768칸(셀 64px 기준 ±200만 px)까지 겹치지 않는 정수 키
    return (cx + 0x8000) * 0x10000 + (cy + 0x8000);
  }

  clear(): void {
    for (const b of this.used) b.length = 0;
    this.used.length = 0;
    // 넓게 돌아다닌 뒤 빈 칸이 너무 많이 쌓이면 정리
    if (this.buckets.size > 8192) this.buckets.clear();
  }

  insert(item: T): void {
    const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    let b = this.buckets.get(k);
    if (!b) {
      b = [];
      this.buckets.set(k, b);
    }
    if (b.length === 0) this.used.push(b);
    b.push(item);
  }

  /**
   * 사각형(화면) 안 칸 중 항목이 가장 많은 칸의 중심(조합 스킬 자동 조준, PRD §6.4). 없으면 null.
   * 이번 프레임에 채워진 칸만 본다.
   */
  densestCell(minX: number, minY: number, maxX: number, maxY: number, filter?: (item: T) => boolean): Point | null {
    let best: Point | null = null;
    let bestCount = 0;
    for (const b of this.used) {
      const first = b[0];
      if (!first) continue;
      const cx = (Math.floor(first.x / this.cellSize) + 0.5) * this.cellSize;
      const cy = (Math.floor(first.y / this.cellSize) + 0.5) * this.cellSize;
      if (cx < minX || cx > maxX || cy < minY || cy > maxY) continue;
      let n = 0;
      for (const it of b) if (!filter || filter(it)) n++;
      if (n > bestCount) {
        bestCount = n;
        best = { x: cx, y: cy };
      }
    }
    return best;
  }

  /** 반경 r 안의 항목마다 fn 호출. fn이 true를 돌려주면 즉시 멈춘다 */
  forEachNear(x: number, y: number, r: number, fn: (item: T, distSq: number) => boolean | void): void {
    const cs = this.cellSize;
    const r2 = r * r;
    const x0 = Math.floor((x - r) / cs);
    const x1 = Math.floor((x + r) / cs);
    const y0 = Math.floor((y - r) / cs);
    const y1 = Math.floor((y + r) / cs);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (!b) continue;
        for (const item of b) {
          const dx = item.x - x;
          const dy = item.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && fn(item, d2) === true) return;
        }
      }
    }
  }

  queryRadius(x: number, y: number, r: number, out: T[] = []): T[] {
    out.length = 0;
    this.forEachNear(x, y, r, (item) => {
      out.push(item);
    });
    return out;
  }

  /** 반경 안에서 가장 가까운 항목(조건 filter를 만족하는 것만) */
  nearest(x: number, y: number, maxR: number, filter?: (item: T) => boolean): T | null {
    let best: T | null = null;
    let bestD = Infinity;
    this.forEachNear(x, y, maxR, (item, d2) => {
      if (d2 < bestD && (!filter || filter(item))) {
        best = item;
        bestD = d2;
      }
    });
    return best;
  }
}
