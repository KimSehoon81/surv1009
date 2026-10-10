import { describe, expect, it } from 'vitest';
import floor from '../src/data/floor.json';
import { chunkMask, chunkPatchCells, type FloorParams } from '../src/core/floorLayout';

const p: FloorParams = floor.S1;

describe('floorLayout', () => {
  it('같은 청크·시드는 같은 무늬(다시 와도 바닥이 바뀌지 않음)', () => {
    expect(chunkPatchCells(3, -2, 'amnok', p)).toEqual(chunkPatchCells(3, -2, 'amnok', p));
  });

  it('셀은 해당 청크 안에만, 중복 없이', () => {
    for (const [cx, cy] of [[0, 0], [-1, 5], [7, -3]] as const) {
      const cells = chunkPatchCells(cx, cy, 's', p);
      const keys = new Set(cells.map((c) => `${c.x},${c.y}`));
      expect(keys.size).toBe(cells.length);
      for (const c of cells) {
        expect(Math.floor(c.x / p.chunkCells)).toBe(cx);
        expect(Math.floor(c.y / p.chunkCells)).toBe(cy);
      }
      expect(cells.length).toBeLessThanOrEqual((p.patchesPerChunk[1] ?? 0) * (p.cellsPerPatch[1] ?? 0));
    }
  });

  it('여러 청크에 걸쳐 패치가 적당히 분포(빈 청크만 나오지 않음)', () => {
    let total = 0;
    for (let i = 0; i < 50; i++) total += chunkPatchCells(i, i * 3, 'amnok', p).length;
    expect(total).toBeGreaterThan(50 * 10);
  });
});

describe('chunkMask', () => {
  it('크기 (chunkCells*sub)², 값은 0/1/2, 같은 입력이면 같은 결과', () => {
    const m = chunkMask(1, 2, 'amnok', p, 4);
    expect(m.length).toBe((p.chunkCells * 4) ** 2);
    expect(new Set(m)).toEqual(new Set([0, 1, 2].filter((v) => m.includes(v))));
    expect(chunkMask(1, 2, 'amnok', p, 4)).toEqual(m);
  });

  it('패치 셀 한가운데는 안쪽(2), 패치에서 먼 곳은 비어 있음(0), 경계(1)가 존재', () => {
    let inner = 0;
    let edge = 0;
    for (let i = 0; i < 20; i++) {
      const m = chunkMask(i, -i, 'amnok', p, 4);
      inner += m.filter((v) => v === 2).length;
      edge += m.filter((v) => v === 1).length;
    }
    expect(inner).toBeGreaterThan(0);
    expect(edge).toBeGreaterThan(0);
    const empty = chunkMask(0, 0, 'x', { ...p, patchesPerChunk: [0, 0] }, 4);
    expect(empty.every((v) => v === 0)).toBe(true);
  });
});
