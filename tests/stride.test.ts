import { describe, expect, it } from 'vitest';
import animations from '../src/data/animations.json';
import { STRIDE_CYCLE, legRegion, strideFrame, type Pixels, type StrideConfig } from '../src/core/stride';

const CFG = animations.stride as unknown as StrideConfig;
/** 20×20: 몸통(8~11열, 2~11행) + 앞다리(12~14열, 14~19행) + 뒷다리(5~7열, 15~19행) */
function soldier(): Pixels {
  const w = 20;
  const h = 20;
  const data = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, r: number) => {
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 3] = 255;
  };
  for (let y = 2; y < 14; y++) for (let x = 8; x < 12; x++) put(x, y, 100);
  for (let y = 14; y < 20; y++) for (let x = 12; x < 15; x++) put(x, y, 200);
  for (let y = 15; y < 20; y++) for (let x = 5; x < 8; x++) put(x, y, 50);
  return { data, w, h };
}
const red = (p: Pixels, x: number, y: number): number => (p.data[(y * p.w + x) * 4 + 3] ? (p.data[(y * p.w + x) * 4] ?? 0) : -1);
const cfg = { ...CFG, legHalfWidth: 8, bobPx: 1 };

describe('걸음 프레임 합성(발 교차)', () => {
  it('주기는 원본 → 모음 → 반대 발 → 모음', () => {
    expect(STRIDE_CYCLE).toEqual(['orig', 'pass', 'mirror', 'pass']);
  });

  it('반대 발: 하체만 좌우 반전, 상체는 그대로', () => {
    const src = soldier();
    const reg = legRegion(src, cfg);
    expect(reg).not.toBeNull();
    const m = strideFrame(src, 'mirror', cfg);
    // 상체 같음
    for (let y = 0; y < (reg?.hip ?? 0); y++) for (let x = 0; x < 20; x++) expect(red(m, x, y)).toBe(red(src, x, y));
    // 앞다리(밝은색 200)가 뒤쪽(왼쪽)으로, 뒷다리(50)가 앞쪽(오른쪽)으로
    const row = 18;
    const xsOf = (p: Pixels, v: number) => [...Array(20).keys()].filter((x) => red(p, x, row) === v);
    const cx = reg?.cx ?? 10;
    expect(Math.max(...xsOf(m, 200))).toBeLessThan(cx);
    expect(Math.min(...xsOf(m, 50))).toBeGreaterThan(cx);
  });

  it('모음: 다리 폭이 좁아지고 한 칸 떠오름, 빈 프레임은 그대로', () => {
    const src = soldier();
    const p = strideFrame(src, 'pass', cfg);
    const span = (q: Pixels, y: number) => {
      const xs = [...Array(20).keys()].filter((x) => red(q, x, y) >= 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(span(p, 17)).toBeLessThan(span(src, 18));
    expect(red(p, 9, 1)).toBe(100); // 몸통 맨 위(2행)가 1행으로
    const empty = { data: new Uint8ClampedArray(16 * 4), w: 4, h: 4 };
    expect(strideFrame(empty, 'mirror', cfg).data).toEqual(empty.data);
  });
});
