import { describe, expect, it } from 'vitest';
import { chunkObstacles, pointInRect, pushOut, resolveCircle, segmentHitsRect, slideDir, type Rect } from '../src/core/obstacles';

const box: Rect = { x: 0, y: 0, w: 100, h: 50 };

describe('장애물 충돌(D32)', () => {
  it('겹치지 않으면 null, 옆에서 겹치면 법선 방향으로 반지름만큼 밀어냄', () => {
    expect(pushOut(-20, 25, 10, box)).toBeNull();
    const p = pushOut(-5, 25, 10, box);
    expect(p?.nx).toBe(-1);
    expect(p?.dx).toBeCloseTo(-5);
    const r = resolveCircle(-5, 25, 10, [box]);
    expect(r.x).toBeCloseTo(-10);
    expect(r.y).toBeCloseTo(25);
  });

  it('중심이 안에 들어가도 가장 가까운 변으로 빠져나옴, 모서리 두 상자 사이도', () => {
    const r = resolveCircle(50, 45, 8, [box]);
    expect(r.y).toBeCloseTo(58);
    expect(r.ny).toBe(1);
    const two = resolveCircle(105, 25, 10, [box, { x: 130, y: 0, w: 50, h: 50 }]);
    expect(pushOut(two.x, two.y, 10, box)).toBeNull();
    expect(pushOut(two.x, two.y, 10, { x: 130, y: 0, w: 50, h: 50 })).toBeNull();
  });

  it('미끄러지기: 비스듬히 부딪히면 접선 방향, 정면이면 목표 쪽 접선, 떨어지는 쪽은 그대로', () => {
    const s = slideDir(Math.SQRT1_2, Math.SQRT1_2, -1, 0, 1, 1);
    expect(s.x).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(1);
    const head = slideDir(1, 0, -1, 0, 50, -30);
    expect(head.x).toBeCloseTo(0);
    expect(head.y).toBeLessThan(0);
    expect(slideDir(-1, 0, -1, 0, 0, 0)).toEqual({ x: -1, y: 0 });
  });

  it('선분 차단: 지나면 true, 비껴가면 false, 점 포함', () => {
    expect(segmentHitsRect(-50, 25, 150, 25, box)).toBe(true);
    expect(segmentHitsRect(-50, 80, 150, 80, box)).toBe(false);
    expect(segmentHitsRect(-50, -50, -10, 100, box)).toBe(false);
    expect(pointInRect(10, 10, box)).toBe(true);
  });

  it('청크 배치: 같은 시드는 같은 결과, 원점 근처 비움, 서로 틈', () => {
    const L = { perChunk: [2, 4], w: [48, 140], h: [36, 110], clear: 220, gap: 40 };
    const a = chunkObstacles(0, 0, 512, L, 's');
    expect(chunkObstacles(0, 0, 512, L, 's')).toEqual(a);
    for (const r of a) expect(pushOut(0, 0, 220, r)).toBeNull();
    for (let i = 0; i < 30; i++) {
      const rs = chunkObstacles(i, -i, 512, L, 'g');
      rs.forEach((r, k) => rs.slice(k + 1).forEach((o) => expect(r.x < o.x + o.w + 40 && o.x < r.x + r.w + 40 && r.y < o.y + o.h + 40 && o.y < r.y + r.h + 40).toBe(false)));
    }
  });
});
