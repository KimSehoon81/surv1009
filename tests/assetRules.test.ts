import { describe, expect, it } from 'vitest';
import { checkAsset } from '../src/core/assetRules';

const rgba = (w: number, h: number) => ({ width: w, height: h, colorType: 6 });
const errors = (path: string, info = rgba(400, 400)) => checkAsset(path, info).filter((i) => i.severity === 'error');

describe('assetRules', () => {
  it('규격에 맞는 파일은 문제 없음', () => {
    expect(checkAsset('chars/A01_attack.png', rgba(400, 400))).toEqual([]);
    expect(checkAsset('chars/A01_idle.png', rgba(400, 400))).toEqual([]);
    expect(checkAsset('enemies/E05_move_L.png', rgba(800, 800))).toEqual([]);
    expect(checkAsset('npcs/N01_talk.png', rgba(400, 400))).toEqual([]);
    expect(checkAsset('tiles/T01.png', { width: 64, height: 64, colorType: 2 })).toEqual([]);
    expect(checkAsset('cards/frame_rare.png', rgba(120, 168))).toEqual([]);
    expect(checkAsset('cards/M00.png', rgba(104, 104))).toEqual([]);
    expect(checkAsset('ui/overlay_snow.png', rgba(120, 168))).toEqual([]);
    expect(checkAsset('ui/star_xp.png', rgba(32, 32))).toEqual([]);
    expect(checkAsset('skills/AS12.png', rgba(32, 32))).toEqual([]);
    expect(checkAsset('fx/explosion_l.png', rgba(800, 800))).toEqual([]);
    expect(checkAsset('props/tree_leaf_L.png', rgba(800, 800))).toEqual([]);
    expect(checkAsset('map/korea_map.png', rgba(360, 540))).toEqual([]);
  });

  it('크기가 틀리면 오류', () => {
    expect(errors('chars/A01_attack.png', rgba(1024, 1024))).toHaveLength(1);
    expect(errors('enemies/E05_move_L.png', rgba(400, 400))).toHaveLength(1);
    expect(errors('tiles/T01.png', rgba(512, 512))).toHaveLength(1);
  });

  it('파일명·동작·폴더가 틀리면 오류', () => {
    expect(errors('chars/A01-attack.png')).toHaveLength(1);
    expect(errors('chars/A01_jump.png')[0]?.message).toContain('알 수 없는 동작');
    expect(errors('chars/E01_move.png')[0]?.message).toContain('enemies/');
    expect(errors('tiles/ground.png', rgba(64, 64))).toHaveLength(1);
  });

  it('스프라이트에 투명 채널이 없으면 주의, PNG가 아니거나 손상되면 각각 주의·오류', () => {
    const w = checkAsset('chars/A01_attack.png', { width: 400, height: 400, colorType: 2 });
    expect(w.map((i) => i.severity)).toEqual(['warn']);
    expect(checkAsset('chars/notes.txt', null)[0]?.severity).toBe('warn');
    expect(checkAsset('chars/A01_attack.png', null)[0]?.severity).toBe('error');
    expect(checkAsset('weird/x.png', rgba(1, 1))[0]?.severity).toBe('warn');
  });
});
