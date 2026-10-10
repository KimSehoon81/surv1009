import { describe, expect, it } from 'vitest';
import { createManifest } from '../src/assets/manifest';

describe('manifest', () => {
  const m = createManifest([
    'chars/A01_attack.png',
    'chars/A01_idle.png',
    'enemies/E05_move_L.png',
    'enemies/E05_move.png',
    'tiles/T01.png',
    'cards/P04.png',
  ]);

  it('ID 접두어로 진영을 판별하고 잘못된 ID는 거부', () => {
    expect(m.factionOf('A01')).toBe('ally');
    expect(m.factionOf('E50')).toBe('enemy');
    expect(m.factionOf('N10')).toBe('npc');
    expect(() => m.factionOf('X01')).toThrow();
    expect(() => m.factionOf('A1')).toThrow();
  });

  it('파일이 있으면 경로, 없으면 null(자리표시자)', () => {
    expect(m.sheet('A01', 'attack').path).toBe('assets/chars/A01_attack.png');
    expect(m.sheet('A01', 'defend').path).toBeNull();
    expect(m.sheet('A01', 'attack').key).toBe('A01_attack');
  });

  it('시트 규격: 100×100 프레임, 4×4 격자, 10프레임', () => {
    const s = m.sheet('A02', 'crit');
    expect([s.frameSize, s.cols, s.rows, s.frames, s.large]).toEqual([100, 4, 4, 10, false]);
  });

  it('대형(_L) 시트가 있으면 우선하고 200×200 프레임', () => {
    const s = m.sheet('E05', 'move');
    expect(s.path).toBe('assets/enemies/E05_move_L.png');
    expect(s.large).toBe(true);
    expect(s.frameSize).toBe(200);
  });

  it('유닛 시트 목록: 아군 6동작 + 파일이 있는 선택 동작(idle)', () => {
    expect(m.unitSheets('A01').map((s) => s.action)).toEqual([
      'attack', 'defend', 'skill', 'move_slow', 'move_fast', 'crit', 'idle',
    ]);
    expect(m.unitSheets('A02')).toHaveLength(6);
    expect(m.unitSheets('E01').map((s) => s.action)).toEqual(['move', 'attack', 'defend', 'crit', 'hit']);
    expect(m.unitSheets('N01').map((s) => s.action)).toEqual(['idle', 'talk', 'give']);
  });

  it('타일 64×64, 카드 120×168', () => {
    expect(m.tile('T01')).toMatchObject({ key: 'tile_T01', width: 64, height: 64, path: 'assets/tiles/T01.png' });
    expect(m.tile('T02').path).toBeNull();
    expect(m.card('P04')).toMatchObject({ key: 'card_P04', width: 120, height: 168 });
  });

  it('발 기준점은 ASSETS.md 규격 (0.5, 0.92)', () => {
    expect(m.anchor).toEqual({ x: 0.5, y: 0.92 });
  });
});
