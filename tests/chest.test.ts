import { describe, expect, it } from 'vitest';
import chest from '../src/data/chest.json';
import { chestCount, dropsChest, type ChestConfig } from '../src/core/chest';
import { createRng } from '../src/core/rng';

const CFG = chest as unknown as ChestConfig;

describe('보물 상자', () => {
  it('엘리트는 늘, 보스는 없음(바로 점령), 일반은 드물게', () => {
    const rng = createRng('c');
    for (let i = 0; i < 20; i++) expect(dropsChest('elite', rng, CFG)).toBe(true);
    expect(dropsChest('boss', rng, CFG)).toBe(false);
    let n = 0;
    for (let i = 0; i < 20000; i++) if (dropsChest('normal', rng, CFG)) n++;
    expect(n / 20000).toBeGreaterThan(CFG.normalChance * 0.5);
    expect(n / 20000).toBeLessThan(CFG.normalChance * 1.6);
  });

  it('개수는 1·3·5 중 하나, 1이 가장 흔함, 같은 시드면 같은 결과', () => {
    const rng = createRng('n');
    const seen: Record<number, number> = {};
    for (let i = 0; i < 3000; i++) {
      const k = chestCount(rng, CFG);
      seen[k] = (seen[k] ?? 0) + 1;
    }
    expect(Object.keys(seen).map(Number).sort()).toEqual([1, 3, 5]);
    expect((seen[1] ?? 0) > (seen[3] ?? 0) && (seen[3] ?? 0) > (seen[5] ?? 0)).toBe(true);
    expect(chestCount(createRng('s'), CFG)).toBe(chestCount(createRng('s'), CFG));
  });
});
