import { describe, expect, it } from 'vitest';
import mapData from '../src/data/map.json';
import stagesData from '../src/data/stages.json';
import { MIGRATIONS, SAVE_VERSION, defaultSave, isUnlocked, isValid, parseSave, recordRun, serialize } from '../src/core/save';

describe('세이브', () => {
  it('왕복: 저장한 그대로 불러온다', () => {
    const d = recordRun(defaultSave(), 'S1', true, 812.4, 300);
    const r = parseSave(serialize(d));
    expect(r.status).toBe('ok');
    expect(r.data).toEqual(d);
    expect(r.data.stages.S1).toEqual({ captured: true, clears: 1, bestTimeSec: 812 });
    expect(r.data.merit).toBe(300);
  });

  it('처음이면 기본값, 예전 키(v0)가 있으면 마이그레이션', () => {
    expect(parseSave(null).status).toBe('new');
    const r = parseSave(null, { guide: { enabled: false, seen: ['move'] }, firstRunDone: true, volume: { bgm: 0.3 }, merit: 42 });
    expect(r.status).toBe('migrated');
    expect(r.data.v).toBe(SAVE_VERSION);
    expect(r.data.merit).toBe(42);
    expect(r.data.settings).toEqual({ volume: { master: 1, bgm: 0.3, sfx: 1, ui: 1 }, guide: false });
    expect(r.data.flags).toEqual({ guideSeen: ['move'], firstRunDone: true });
    expect(isValid(r.data)).toBe(true);
  });

  it('마이그레이션 표가 0부터 현재 버전 직전까지 빠짐없이 있다', () => {
    for (let v = 0; v < SAVE_VERSION; v++) expect(MIGRATIONS[v], `v${v}`).toBeTypeOf('function');
    // 버전 표시 없는 옛 저장 문자열도 v0으로 보고 올린다
    const r = parseSave(JSON.stringify({ legacy: { merit: 7 } }));
    expect(r.status).toBe('migrated');
    expect(r.data.merit).toBe(7);
  });

  it('손상(JSON 깨짐·필수 필드 누락·숫자 아님)은 corrupt로 새로 시작', () => {
    expect(parseSave('{"v":1,').status).toBe('corrupt');
    expect(parseSave('[]').status).toBe('corrupt');
    const broken = { ...defaultSave(), merit: 'many' };
    expect(parseSave(JSON.stringify(broken)).status).toBe('corrupt');
    const missing: Record<string, unknown> = { ...defaultSave() };
    delete missing.flags;
    const r = parseSave(JSON.stringify(missing));
    expect(r.status).toBe('corrupt');
    expect(r.data).toEqual(defaultSave());
  });

  it('지역은 남→북 순서로 앞 지역을 점령해야 열린다', () => {
    const order = mapData.nodes.map((n) => n.id);
    let d = defaultSave();
    expect(isUnlocked(d, order, 'S1')).toBe(true);
    expect(isUnlocked(d, order, 'S2')).toBe(false);
    d = recordRun(d, 'S1', false, 300, 20);
    expect(isUnlocked(d, order, 'S2')).toBe(false);
    d = recordRun(d, 'S1', true, 800, 400);
    expect(isUnlocked(d, order, 'S2')).toBe(true);
    expect(d.merit).toBe(420);
  });
});

describe('작전지도 데이터', () => {
  it('10개 지역, 남→북(y가 대체로 작아짐), S1은 스테이지 데이터가 있다', () => {
    expect(mapData.nodes).toHaveLength(10);
    expect(mapData.nodes.map((n) => n.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
    const first = mapData.nodes[0];
    const last = mapData.nodes[9];
    expect((first?.y ?? 0) > (last?.y ?? 0)).toBe(true);
    expect(stagesData.stages).toHaveProperty('S1');
    for (const n of mapData.nodes) expect(n.x >= 0 && n.x <= 960 && n.y >= 0 && n.y <= 540, n.id).toBe(true);
  });
});
