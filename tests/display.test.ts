import { describe, expect, it } from 'vitest';
import { computeZoom } from '../src/config/display';

describe('computeZoom', () => {
  it('1920×1080 → 정수 2배, 2560×1440 → 2배, 3840×2160 → 4배', () => {
    expect(computeZoom(1920, 1080)).toBe(2);
    expect(computeZoom(2560, 1440)).toBe(2);
    expect(computeZoom(3840, 2160)).toBe(4);
  });

  it('1366×768, 1536×864처럼 2배가 안 되는 창은 1배', () => {
    expect(computeZoom(1366, 768)).toBe(1);
    expect(computeZoom(1536, 864)).toBe(1);
  });

  it('960×540보다 작은 창만 비정수로 줄인다', () => {
    const z = computeZoom(800, 450);
    expect(z).toBeLessThan(1);
    expect(z).toBeGreaterThan(0.8);
    expect(computeZoom(10, 10)).toBe(0.25);
  });

  it('잘못된 크기는 1', () => {
    expect(computeZoom(0, 0)).toBe(1);
    expect(computeZoom(Number.NaN, 100)).toBe(1);
  });
});
