import { describe, expect, it } from 'vitest';
import timelinesData from '../src/data/timelines.json';
import cuesData from '../src/data/cues.json';
import combosData from '../src/data/combos.json';
import feelData from '../src/data/feel.json';
import sfxData from '../src/data/sfx.json';
import skillsData from '../src/data/skills.json';
import { MARKER_CUE, TimelinePlayer, expandTimeline, type TimelineDef } from '../src/core/timeline';
import { SpatialHash } from '../src/core/spatialHash';
import { FRAME_MS } from '../src/core/feel';

const TL = timelinesData.timelines as unknown as Record<string, TimelineDef>;
const CUES = cuesData.cues as Record<string, { feel?: string; sfx?: string; countdown?: { sfx?: string } }>;
const PRESETS = feelData.presets as Record<string, { hitstopFrames?: number }>;
const origin = { aim: { x: 300, y: 0 }, player: { x: 0, y: 0 }, minFanDist: 100 };
const rand = () => 0.5;

describe('연출 타임라인 데이터', () => {
  it('조합 11종 전부 타임라인이 있고, 쓰는 큐·프리셋·소리가 모두 정의돼 있다', () => {
    const combos = new Set(combosData.combos.map((c) => c.id));
    expect(combos.size).toBe(11);
    for (const id of combos) expect(TL[id], id).toBeDefined();
    // 타임라인은 조합 스킬 또는 고급 스킬(skills.json timeline)이 쓴다
    const skillTimelines = new Set(Object.values(skillsData.skills).map((s) => (s as { timeline?: string }).timeline));
    for (const [id, def] of Object.entries(TL)) {
      expect(combos.has(id) || skillTimelines.has(id), id).toBe(true);
      for (const ev of def.events) {
        for (const cue of [ev.cue, ev.repeat?.lastCue, ...(ev.pre ?? []).map((p) => p.cue)].filter((c): c is string => !!c)) {
          const c = CUES[cue];
          expect(c, `${id}:${cue}`).toBeDefined();
          if (c?.feel) expect(PRESETS[c.feel], c.feel).toBeDefined();
          for (const s of [c?.sfx, c?.countdown?.sfx]) if (s) expect((sfxData.cues as Record<string, unknown>)[s], s).toBeDefined();
        }
      }
    }
  });

  it('펼친 이벤트 시각 = JSON의 t(+ 반복 간격), 마커는 착탄 markerLead초 전', () => {
    for (const [id, def] of Object.entries(TL)) {
      const out = expandTimeline(def, origin, rand);
      for (const ev of def.events) {
        const n = ev.repeat?.count ?? 1;
        for (let i = 0; i < n; i++) {
          const at = Math.round((ev.t + i * (ev.repeat?.every ?? 0)) * 1000);
          const hits = out.filter((e) => e.atMs === at && e.cue !== MARKER_CUE && e.index === i);
          expect(hits.length, `${id} t=${ev.t} #${i}`).toBeGreaterThan(0);
          if (ev.markerLead) {
            const m = out.find((e) => e.cue === MARKER_CUE && e.index === i && e.atMs + e.durationMs === at);
            expect(m, `${id} marker #${i}`).toBeDefined();
          }
        }
      }
      for (let i = 1; i < out.length; i++) expect((out[i]?.atMs ?? 0) >= (out[i - 1]?.atMs ?? 0)).toBe(true);
    }
  });

  it('정밀 폭격은 §6.2 순서(마커 0.0 → 그림자 0.8 → 폭격기 1.0 → 낙하 1.6 → 착탄 1.9 → 잔불 2.5)', () => {
    const out = expandTimeline(TL.precision_bomb as TimelineDef, origin, rand);
    expect(out.map((e) => [e.atMs, e.cue])).toEqual([
      [0, MARKER_CUE],
      [800, 'bomber_shadow'],
      [1000, 'bomber'],
      [1600, 'bomb_fall'],
      [1900, 'bomb_impact_l'],
      [2500, 'afterburn'],
    ]);
  });

  it('연속 착탄은 히트스톱을 마지막 1발에만 둔다(편대·연발탄)', () => {
    for (const id of ['bomber_wing', 'barrage']) {
      const impacts = expandTimeline(TL[id] as TimelineDef, origin, rand).filter((e) => e.damage > 0);
      const stops = impacts.map((e) => PRESETS[CUES[e.cue]?.feel ?? '']?.hitstopFrames ?? 0);
      expect(stops.slice(0, -1).every((f) => f === 0), id).toBe(true);
      expect(stops[stops.length - 1], id).toBeGreaterThan(0);
    }
  });

  it('편대는 0.3초 간격 3발이 한 줄, 연발탄은 0.12초 간격 8발 부채꼴', () => {
    const wing = expandTimeline(TL.bomber_wing as TimelineDef, origin, rand).filter((e) => e.damage > 0);
    expect(wing.map((e) => e.atMs)).toEqual([1900, 2200, 2500]);
    expect(new Set(wing.map((e) => e.y)).size).toBe(1);
    const shells = expandTimeline(TL.barrage as TimelineDef, origin, rand).filter((e) => e.damage > 0);
    expect(shells).toHaveLength(8);
    expect(shells.map((e) => e.atMs)).toEqual([600, 720, 840, 960, 1080, 1200, 1320, 1440]);
    const angles = shells.map((e) => Math.atan2(e.y, e.x));
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo((70 * Math.PI) / 180, 5);
    for (const e of shells) expect(Math.hypot(e.x, e.y)).toBeCloseTo(300, 5);
  });
});

describe('앞당긴 큐와 방향', () => {
  it('함포: 포탄 비행(pre)은 착탄과 같은 자리에서 lead초 먼저, 시간 = lead', () => {
    const out = expandTimeline(TL.naval_support as TimelineDef, origin, Math.random);
    const impacts = out.filter((e) => e.damage > 0);
    expect(impacts).toHaveLength(3);
    for (const imp of impacts) {
      const arc = out.find((e) => e.cue === 'naval_arc' && e.index === imp.index);
      expect(arc).toMatchObject({ x: imp.x, y: imp.y, atMs: imp.atMs - 700, durationMs: 700 });
    }
  });

  it('모든 이벤트에 플레이어 → 조준점 방향(단위 벡터)', () => {
    const out = expandTimeline(TL.tank_breakthrough as TimelineDef, { aim: { x: 0, y: -50 }, player: { x: 0, y: 0 } }, rand);
    expect(out[0]).toMatchObject({ dirX: 0, dirY: -1 });
    const same = expandTimeline(TL.tank_breakthrough as TimelineDef, { aim: { x: 5, y: 5 }, player: { x: 5, y: 5 } }, rand);
    expect(same[0]).toMatchObject({ dirX: 1, dirY: 0 });
  });
});

describe('타임라인 재생', () => {
  it('60fps로 진행하면 각 이벤트는 t에 도달한 첫 프레임에 한 번씩 나온다', () => {
    for (const def of Object.values(TL)) {
      const events = expandTimeline(def, origin, rand);
      const p = new TimelinePlayer(events, 5000);
      const fired: { at: number; now: number }[] = [];
      for (let now = 5000; !p.done && now < 20000; now += FRAME_MS) {
        for (const e of p.due(now)) fired.push({ at: e.atMs, now: now - 5000 });
      }
      expect(fired).toHaveLength(events.length);
      for (const f of fired) {
        expect(f.now).toBeGreaterThanOrEqual(f.at);
        expect(f.now - f.at).toBeLessThan(FRAME_MS);
      }
    }
  });

  it('시계가 멈추면(일시정지·레벨업) 아무것도 나오지 않는다', () => {
    const p = new TimelinePlayer(expandTimeline(TL.timebomb as TimelineDef, origin, rand), 0);
    p.due(1000);
    expect(p.due(1000)).toEqual([]);
  });
});

describe('자동 조준', () => {
  it('화면 안 칸 중 적이 가장 많은 칸의 중심', () => {
    const g = new SpatialHash<{ x: number; y: number; alive: boolean }>(64);
    for (let i = 0; i < 3; i++) g.insert({ x: 10 + i, y: 10, alive: true });
    for (let i = 0; i < 5; i++) g.insert({ x: 200 + i, y: 70, alive: i < 4 });
    for (let i = 0; i < 9; i++) g.insert({ x: 2000, y: 2000, alive: true });
    expect(g.densestCell(0, 0, 960, 540, (e) => e.alive)).toEqual({ x: 224, y: 96 });
    expect(g.densestCell(0, 0, 960, 540, () => false)).toBeNull();
  });
});
