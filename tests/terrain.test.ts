import { describe, expect, it } from 'vitest';
import terrainData from '../src/data/terrain.json';
import { chunkSpots, inStream, streamAt, streamsNear, type TerrainCfg } from '../src/core/terrain';

const S: TerrainCfg['streams'] = { spacing: 1400, amp: 90, wavelength: 700, width: [14, 22] };
const stream = S as NonNullable<typeof S>;

describe('바닥 지형: 개울·풀숲·눈', () => {
  it('출정 자리(원점) 근처에는 개울이 없음', () => {
    for (const seed of [1, 2, 3, 99]) for (let x = -400; x <= 400; x += 20) for (let y = -300; y <= 300; y += 20) expect(inStream(stream, seed, x, y)).toBe(false);
  });

  it('중심선 위는 물, 멀리 떨어지면 물이 아님', () => {
    for (const x of [-3000, -50, 0, 777, 5000]) {
      const k = 0;
      const { center, half } = streamAt(stream, 7, k, x);
      expect(half).toBeGreaterThanOrEqual(7);
      expect(inStream(stream, 7, x, center)).toBe(true);
      expect(inStream(stream, 7, x, center + half + 40)).toBe(false);
    }
  });

  it('곡선은 가로 좌표만의 함수라 청크 경계에서도 이어짐', () => {
    const a = streamAt(stream, 5, 1, 512);
    const b = streamAt(stream, 5, 1, 512);
    expect(a).toEqual(b);
    const near = streamAt(stream, 5, 1, 514);
    expect(Math.abs(near.center - a.center)).toBeLessThan(3);
  });

  it('구간에 걸칠 수 있는 개울 번호에 실제 개울이 빠지지 않음', () => {
    for (let y = -5000; y < 5000; y += 97) {
      const ks = streamsNear(stream, y, y);
      for (let k = -6; k <= 6; k++) {
        const { center, half } = streamAt(stream, 3, k, 123);
        if (Math.abs(y - center) <= half) expect(ks).toContain(k);
      }
    }
  });

  it('풀숲·눈 자리는 청크마다 같은 결과, 개울 물 위는 없음', () => {
    const t: TerrainCfg = { season: 'winter', streams: stream, grass: [4, 8], snow: [3, 6] };
    const a = chunkSpots(t, 11, 2, 1, 512);
    expect(chunkSpots(t, 11, 2, 1, 512)).toEqual(a);
    for (const s of [...a.grass, ...a.snow]) expect(inStream(stream, 11, 2 * 512 + s.x, 512 + s.y)).toBe(false);
  });

  it('모든 스테이지에 계절이 있고 겨울엔 눈, 서울은 개울 없음', () => {
    const f = terrainData.stages as unknown as Record<string, TerrainCfg>;
    for (let i = 1; i <= 10; i++) expect(f[`S${i}`]?.season, `S${i}`).toBeTruthy();
    expect(f.S6?.streams).toBeUndefined();
    expect(f.S10?.snow?.[0]).toBeGreaterThan(0);
    for (const t of Object.values(f)) expect((terrainData.palettes as Record<string, unknown>)[t.season]).toBeDefined();
  });
});
