// 걸음 프레임 합성: 원본 이동 프레임의 하체를 좌우 반전(반대 발이 앞) · 가운데로 모음(발 바꾸는 중간 자세).
// AI로 만든 이동 시트가 다리 자세가 거의 같아 발이 안 바뀌어 보이는 문제를 원본 그림을 건드리지 않고 메운다.
// Phaser 없음(테스트 대상). 픽셀은 RGBA 한 줄 배열.

export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
}

export interface StrideConfig {
  /** 몸(불투명 영역) 위에서부터 이 비율 아래를 하체로 */
  hipFrac: number;
  /** 하체로 다룰 가로 반폭(px): 총구·장비 끝은 건드리지 않게 다리 둘레만 */
  legHalfWidth: number;
  /** 중간 자세에서 다리를 모으는 배율 */
  passScale: number;
  /** 중간 자세에서 몸이 떠오르는 픽셀 */
  bobPx: number;
}

export type StrideMode = 'orig' | 'pass' | 'mirror';
/** 한 걸음 주기: 원본 → 모음 → 반대 발 → 모음 */
export const STRIDE_CYCLE: readonly StrideMode[] = ['orig', 'pass', 'mirror', 'pass'];

const alphaAt = (p: Pixels, x: number, y: number): number => p.data[(y * p.w + x) * 4 + 3] ?? 0;

/** 하체 영역(엉덩이 높이·다리 가로 중심). 빈 프레임이면 null */
export function legRegion(p: Pixels, cfg: StrideConfig): { hip: number; cx: number } | null {
  let y0 = -1;
  let y1 = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (alphaAt(p, x, y) > 0) {
        if (y0 < 0) y0 = y;
        y1 = y;
        break;
      }
  if (y0 < 0) return null;
  const hip = Math.round(y0 + (y1 - y0) * cfg.hipFrac);
  let sum = 0;
  let n = 0;
  for (let y = hip; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (alphaAt(p, x, y) > 0) {
        sum += x;
        n++;
      }
  return n > 0 ? { hip, cx: sum / n } : null;
}

/** 걸음 프레임 하나. orig면 그대로 복사 */
export function strideFrame(src: Pixels, mode: StrideMode, cfg: StrideConfig): Pixels {
  const out = new Uint8ClampedArray(src.data);
  const reg = mode === 'orig' ? null : legRegion(src, cfg);
  if (!reg) return { data: out, w: src.w, h: src.h };
  const { hip, cx } = reg;
  const lo = Math.max(0, Math.floor(cx - cfg.legHalfWidth));
  const hi = Math.min(src.w - 1, Math.ceil(cx + cfg.legHalfWidth));
  const copy = (dx: number, dy: number, sx: number, sy: number) => {
    const d = (dy * src.w + dx) * 4;
    const s = (sy * src.w + sx) * 4;
    for (let k = 0; k < 4; k++) out[d + k] = src.data[s + k] ?? 0;
  };
  for (let y = hip; y < src.h; y++)
    for (let x = lo; x <= hi; x++) {
      // 대상 칸마다 원본에서 가져올 x(가장 가까운 칸): 반전은 cx 기준 대칭, 모음은 cx 쪽으로 당김
      const sx = Math.round(mode === 'mirror' ? 2 * cx - x : cx + (x - cx) / cfg.passScale);
      const d = (y * src.w + x) * 4;
      if (sx < lo || sx > hi) {
        out[d + 3] = 0;
        continue;
      }
      copy(x, y, sx, y);
    }
  if (mode !== 'pass' || cfg.bobPx <= 0) return { data: out, w: src.w, h: src.h };
  // 중간 자세: 몸 전체를 bobPx 위로
  const up = new Uint8ClampedArray(out.length);
  const shift = cfg.bobPx * src.w * 4;
  up.set(out.subarray(shift), 0);
  return { data: up, w: src.w, h: src.h };
}
