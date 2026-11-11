import { describe, expect, it } from 'vitest';
import propsData from '../src/data/props.json';
import { chunkProps, propFrame, type PropLayout } from '../src/core/props';

const L = (propsData.stages as Record<string, PropLayout>).S1 as PropLayout;

describe('배경 소품(D37)', () => {
  it('같은 시드·청크면 같은 배치, 청크당 상한, 원점 근처 비움', () => {
    expect(chunkProps(2, -1, 512, L, 's')).toEqual(chunkProps(2, -1, 512, L, 's'));
    for (let i = 0; i < 40; i++) {
      const ps = chunkProps(i, i - 20, 512, L, 'g');
      expect(ps.length).toBeLessThanOrEqual(L.max);
      for (const p of ps) expect(p.x * p.x + p.y * p.y).toBeGreaterThanOrEqual(L.clear * L.clear);
    }
  });

  it('흔들림은 소품마다 시작 프레임이 어긋남(같은 시각에 모두 같은 프레임이 아님)', () => {
    const ps = [0, 1, 2, 3].flatMap((i) => chunkProps(i, 1, 512, L, 'p')).filter((p) => p.kind.anim !== 'still');
    const frames = new Set(ps.map((p) => propFrame(p.kind.anim, p.phase, 1000, 8)));
    expect(frames.size).toBeGreaterThan(1);
    expect(propFrame('still', 3, 5000, 8)).toBe(0);
    expect(propFrame('sway', 0, 0, 8)).toBe(0);
    expect(propFrame('sway', 2, 250, 8)).toBe(4);
  });

  it('스테이지 1~10 모두 소품 표, 종류마다 그림 이름·가중치', () => {
    for (let s = 1; s <= 10; s++) {
      const st = (propsData.stages as Record<string, PropLayout>)[`S${s}`];
      expect(st, `S${s}`).toBeDefined();
      for (const k of st?.kinds ?? []) expect(k.weight).toBeGreaterThan(0);
    }
  });
});
