import { describe, expect, it } from 'vitest';
import { insideOutpost, outpostRatio, stepOutpost, type OutpostCfg, type OutpostState } from '../src/core/outpost';
import { resolveLethal } from '../src/core/lastStand';
import outpost from '../src/data/outpost.json';
import combat from '../src/data/combat.json';
import feel from '../src/data/feel.json';
import sfx from '../src/data/sfx.json';
import ko from '../src/i18n/ko.json';
import { EFFECTS } from '../src/systems/effects';

const cfg: OutpostCfg = { radius: 70, captureMs: 6000, decayMul: 0.5, lifeMs: 30000 };
const fresh = (): OutpostState => ({ x: 100, y: 100, bornMs: 0, progressMs: 0 });

describe('고지 점령(core/outpost)', () => {
  it('원 안팎 판정(테두리 포함)', () => {
    expect(insideOutpost(fresh(), 100, 100, 70)).toBe(true);
    expect(insideOutpost(fresh(), 170, 100, 70)).toBe(true);
    expect(insideOutpost(fresh(), 171, 100, 70)).toBe(false);
    expect(insideOutpost(fresh(), 150, 150, 70)).toBe(false);
  });

  it('안에서 버티면 진행이 쌓여 captureMs에 점령', () => {
    const s = fresh();
    let step = 'hold';
    let t = 0;
    while (step === 'hold' && t < 10000) {
      t += 100;
      const r = stepOutpost(s, true, 100, t, cfg);
      s.progressMs = r.progressMs;
      step = r.step;
    }
    expect(step).toBe('captured');
    expect(t).toBe(6000);
    expect(outpostRatio(s, cfg)).toBe(1);
  });

  it('밖에 있으면 진행이 decayMul 속도로 줄고 0 아래로는 안 내려감', () => {
    const s = { ...fresh(), progressMs: 3000 };
    const r = stepOutpost(s, false, 1000, 5000, cfg);
    expect(r.progressMs).toBe(2500);
    expect(r.step).toBe('hold');
    expect(stepOutpost({ ...fresh(), progressMs: 100 }, false, 1000, 5000, cfg).progressMs).toBe(0);
    expect(outpostRatio({ progressMs: 1500 }, cfg)).toBe(0.25);
  });

  it('제한 시간이 지나면 사라지지만, 원 안에서 올리는 중이면 사라지지 않음', () => {
    expect(stepOutpost({ ...fresh(), progressMs: 2000 }, false, 16, 30000, cfg).step).toBe('expired');
    expect(stepOutpost({ ...fresh(), progressMs: 2000 }, true, 16, 99999, cfg).step).toBe('hold');
    expect(stepOutpost(fresh(), false, 16, 29999, cfg).step).toBe('hold');
  });

  it('outpost.json: 보상 효과가 실제 핸들러이고, 수치가 말이 됨', () => {
    for (const r of outpost.rewards) expect(EFFECTS, r.effect).toHaveProperty(r.effect);
    expect(outpost.captureMs).toBeGreaterThanOrEqual(3000);
    expect(outpost.captureMs).toBeLessThan(outpost.lifeMs);
    expect(outpost.distance[0]).toBeGreaterThan(outpost.radius);
    expect(outpost.everySec).toBeGreaterThan(outpost.lifeMs / 1000);
    // 안내 문구의 버프 시간과 실제 버프 시간이 같음
    for (const r of outpost.rewards) if (r.effect === 'buff') expect((r.params as { ms: number }).ms).toBe(outpost.buffSec * 1000);
    expect(ko.battle.outpost.spawn).toContain('{sec}');
    expect(ko.hud.poi.outpost.length).toBeGreaterThan(0);
  });
});

describe('구사일생(core/lastStand)', () => {
  const L = { uses: 1, hpRatio: 0.25 };

  it('쓰러질 피해를 한 번은 버팀: 체력을 비율만큼 남기고 횟수 +1', () => {
    expect(resolveLethal(0, 100, 0, L)).toEqual({ saved: true, hp: 25, used: 1 });
    expect(resolveLethal(-40, 10, 0, { uses: 1, hpRatio: 0.01 })).toEqual({ saved: true, hp: 1, used: 1 });
  });

  it('이미 썼으면 쓰러짐, 살아 있으면 아무 일 없음', () => {
    expect(resolveLethal(0, 100, 1, L)).toEqual({ saved: false, hp: 0, used: 1 });
    expect(resolveLethal(30, 100, 0, L)).toEqual({ saved: false, hp: 30, used: 0 });
    expect(resolveLethal(0, 100, 0, { uses: 0, hpRatio: 0.25 }).saved).toBe(false);
  });

  it('combat.json: 판마다 횟수·체력·무적이 과하지 않음', () => {
    const c = combat.lastStand;
    expect(c.uses).toBeGreaterThanOrEqual(0);
    expect(c.uses).toBeLessThanOrEqual(2);
    expect(c.hpRatio).toBeGreaterThan(0);
    expect(c.hpRatio).toBeLessThanOrEqual(0.5);
    expect(c.invulnMs).toBeLessThanOrEqual(4000);
  });
});

describe('눈부심·효과음 데이터', () => {
  it('feel.json glare: 종류마다 색·크기가 있고, 번쩍임은 과하지 않게(알파 0.6 이하, 간격 200ms 이상)', () => {
    const g = feel.glare as unknown as Record<string, unknown>;
    expect(feel.glare.minGapMs).toBeGreaterThanOrEqual(200);
    for (const kind of ['skill', 'skillBig', 'opSuccess', 'combo', 'outpost', 'lastStand']) {
      const c = g[kind] as { color: string; veil: number; core: number; rays: number; ms: number };
      expect(c.color, kind).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.veil, kind).toBeLessThanOrEqual(0.6);
      expect(c.core, kind).toBeGreaterThan(100);
      expect(c.rays, kind).toBeGreaterThan(0);
      expect(c.ms, kind).toBeGreaterThanOrEqual(300);
    }
  });

  it('기술·점령·구사일생 프리셋의 소리와 새 소리가 sfx.json에 있음', () => {
    const cues = sfx.cues as Record<string, { src: string }>;
    const sources = sfx.sources as Record<string, unknown>;
    const presets = feel.presets as Record<string, { sfx?: string }>;
    for (const p of ['skill_cast', 'skill_cast_big', 'last_stand', 'outpost_capture']) {
      const name = presets[p]?.sfx;
      expect(name, p).toBeTruthy();
      expect(cues[name as string], `${p} → ${name}`).toBeDefined();
    }
    for (const c of ['skill_cast', 'skill_ult', 'op_shine', 'heartbeat', 'capture', 'last_stand']) {
      expect(cues[c], c).toBeDefined();
      expect(sources[cues[c]?.src ?? ''], c).toBeDefined();
    }
    expect(feel.lowHp.beatMs[0]).toBeGreaterThan(feel.lowHp.beatMs[1] ?? 0);
  });
});
