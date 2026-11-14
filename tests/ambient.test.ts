import { describe, expect, it } from 'vitest';
import ambientData from '../src/data/ambient.json';
import stagesData from '../src/data/stages.json';
import { fleeDir, nextWander, outside, spawnPoint, type AmbientCfg } from '../src/core/ambient';
import { createRng } from '../src/core/rng';

const cfg = ambientData as unknown as AmbientCfg;
const view = { x: 0, y: 0, w: 960, h: 540 };

describe('주변 생활', () => {
  it('화면 바로 바깥에서 나타나 안쪽으로 걸어 들어옴', () => {
    const rng = createRng('amb');
    for (let i = 0; i < 200; i++) {
      const p = spawnPoint(rng, view, cfg.spawnMargin);
      expect(outside(p.x, p.y, view, cfg.spawnMargin - 1)).toBe(true);
      expect(outside(p.x, p.y, view, cfg.spawnMargin + 1)).toBe(false);
      // 가운데 쪽을 향함
      expect((480 - p.x) * p.dirX + (270 - p.y) * p.dirY).toBeGreaterThan(0);
    }
  });

  it('가까운 폭발에서만 반대쪽으로 떠남', () => {
    expect(fleeDir({ x: 100, y: 0 }, { x: 0, y: 0, r: 40 }, cfg)).toEqual({ dirX: 1, dirY: 0 });
    expect(fleeDir({ x: cfg.fleeRadius + 41, y: 0 }, { x: 0, y: 0, r: 40 }, cfg)).toBeNull();
    expect(fleeDir({ x: 0, y: 0 }, { x: 0, y: 0, r: 0 }, cfg)).toEqual({ dirX: 1, dirY: 0 });
  });

  it('플레이어가 가까우면 멀어지는 쪽으로 걷기', () => {
    const w = nextWander(createRng('w'), cfg, { x: 10, y: 0 }, { x: 0, y: 0 });
    expect(w.mode).toBe('walk');
    expect(w.dirX).toBeCloseTo(1);
  });

  it('지역 목록은 있는 스테이지·정의된 것만', () => {
    const crit = ambientData.critters as Record<string, unknown>;
    for (const [stage, ids] of Object.entries(ambientData.stages)) {
      expect(stage in stagesData.stages).toBe(true);
      for (const id of ids) expect(crit[id], id).toBeDefined();
    }
  });
});
