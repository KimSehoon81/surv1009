// 배경 소품 배치(PRD §9.5, D37): 바닥 청크와 같은 시드 청크 방식. 같은 시드·청크면 늘 같은 배치. Phaser 없음(테스트 대상).
import { createRng } from './rng';

export type PropAnim = 'sway' | 'flag' | 'fire' | 'still';

export interface PropKind {
  sprite: string;
  weight: number;
  anim: PropAnim;
  /** 풀·억새: 플레이어가 지나가면 밟힘 프레임 */
  grass?: boolean;
  scale?: number;
}

export interface PropLayout {
  /** 청크당 개수 [최소, 최대] */
  density: readonly number[];
  /** 청크당 상한(성능) */
  max: number;
  /** 원점(출정 자리) 반경 안은 비움 */
  clear: number;
  kinds: readonly PropKind[];
}

export interface PlacedProp {
  x: number;
  y: number;
  kind: PropKind;
  /** 루프 시작 프레임(0~5): 소품마다 어긋나 동시에 흔들리지 않게 */
  phase: number;
}

export function chunkProps(cx: number, cy: number, chunkPx: number, L: PropLayout, seed: string): PlacedProp[] {
  const rng = createRng(`${seed}:props:${cx},${cy}`);
  const [lo = 0, hi = lo] = L.density;
  const n = Math.min(L.max, lo + Math.floor(rng.next() * (hi - lo + 1)));
  const total = L.kinds.reduce((s, k) => s + k.weight, 0);
  const out: PlacedProp[] = [];
  for (let i = 0; i < n; i++) {
    const x = cx * chunkPx + rng.next() * chunkPx;
    const y = cy * chunkPx + rng.next() * chunkPx;
    let pick = rng.next() * total;
    const kind = L.kinds.find((k) => (pick -= k.weight) < 0) ?? L.kinds[L.kinds.length - 1];
    const phase = Math.floor(rng.next() * 6);
    if (!kind || x * x + y * y < L.clear * L.clear) continue;
    out.push({ x: Math.round(x), y: Math.round(y), kind, phase });
  }
  return out;
}

/** 지금 프레임: 루프(6칸)는 시작 프레임만큼 어긋나고, 정지 소품은 0 */
export function propFrame(anim: PropAnim, phase: number, timeMs: number, fps: number): number {
  if (anim === 'still') return 0;
  return (Math.floor((timeMs / 1000) * fps) + phase) % 6;
}
