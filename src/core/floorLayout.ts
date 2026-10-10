// 바닥 패치 배치(순수 함수). 청크 좌표와 시드만으로 결정되어, 같은 곳에 다시 오면 같은 무늬가 나온다.
import { createRng } from './rng';

export interface FloorParams {
  cell: number;
  chunkCells: number;
  /** [최소, 최대] */
  patchesPerChunk: readonly number[];
  /** [최소, 최대] */
  cellsPerPatch: readonly number[];
}

export interface Cell {
  /** 월드 셀 좌표(cell px 단위) */
  x: number;
  y: number;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** 한 청크 안의 패치 셀 목록. 패치는 무작위 걸음으로 자란 덩어리이고 청크 밖으로 나가지 않는다 */
export function chunkPatchCells(cx: number, cy: number, seed: string | number, p: FloorParams): Cell[] {
  const rng = createRng(seed).fork(`floor:${cx},${cy}`);
  const n = p.chunkCells;
  const taken = new Set<number>();
  const out: Cell[] = [];
  const patches = rng.int(p.patchesPerChunk[0] ?? 0, p.patchesPerChunk[1] ?? 0);
  for (let i = 0; i < patches; i++) {
    const size = rng.int(p.cellsPerPatch[0] ?? 1, p.cellsPerPatch[1] ?? 1);
    // 청크 가장자리에서 조금 떨어진 곳에서 시작해 덩어리가 잘리지 않게
    let x = rng.int(2, n - 3);
    let y = rng.int(2, n - 3);
    const frontier: Array<[number, number]> = [[x, y]];
    let added = 0;
    // 무작위 걸음이 이미 칠한 곳만 맴돌아도 끝나도록 반복 상한
    for (let guard = 0; added < size && guard < size * 30; guard++) {
      const [fx, fy] = frontier[rng.int(0, frontier.length - 1)] as [number, number];
      x = fx;
      y = fy;
      const key = y * n + x;
      if (!taken.has(key)) {
        taken.add(key);
        out.push({ x: cx * n + x, y: cy * n + y });
        added++;
      }
      const [dx, dy] = rng.pick(DIRS);
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n) frontier.push([nx, ny]);
      if (frontier.length > 64) frontier.shift();
    }
  }
  return out;
}

/** 패치 마스크 단계: 0 없음, 1 경계(반쯤 섞임), 2 안쪽 */
export type MaskLevel = 0 | 1 | 2;

/**
 * 청크의 패치를 sub배 잘게 나눈 마스크. 셀 소속을 쌍선형으로 보간하고 시드 잡음을 더해
 * 직각 계단 모서리 대신 불규칙하게 번지는 가장자리를 만든다. 결과는 (chunkCells*sub)² 칸, 행 우선.
 */
export function chunkMask(cx: number, cy: number, seed: string | number, p: FloorParams, sub: number, noise = 0.35): Uint8Array {
  const n = p.chunkCells;
  const member = new Float32Array(n * n);
  for (const c of chunkPatchCells(cx, cy, seed, p)) member[(c.y - cy * n) * n + (c.x - cx * n)] = 1;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : (member[y * n + x] as number));
  const rng = createRng(seed).fork(`mask:${cx},${cy}`);
  const size = n * sub;
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const fy = (j + 0.5) / sub - 0.5;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let i = 0; i < size; i++) {
      const fx = (i + 0.5) / sub - 0.5;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const v =
        at(x0, y0) * (1 - tx) * (1 - ty) + at(x0 + 1, y0) * tx * (1 - ty) + at(x0, y0 + 1) * (1 - tx) * ty + at(x0 + 1, y0 + 1) * tx * ty;
      const jittered = v + (rng.next() - 0.5) * noise;
      out[j * size + i] = jittered > 0.62 ? 2 : jittered > 0.38 ? 1 : 0;
    }
  }
  return out;
}
