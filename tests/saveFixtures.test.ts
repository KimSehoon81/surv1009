import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAVE_VERSION, isValid, parseSave, serialize, type LegacyKeys, type SaveData } from '../src/core/save';
import { applyCapture, openSlots, runInit } from '../src/core/meta';
import metaData from '../src/data/meta.json';
import unlocksData from '../src/data/unlocks.json';
import { hasBackup, loadProfile, resetProfile, restoreBackup, saveProfile } from '../src/systems/save';

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}`, 'utf8');
const V1 = ['save-v1-d17.json', 'save-v1-d29.json', 'save-v1-d42.json'];

describe('세이브 픽스처(D43): 과거 모든 형식이 최신으로 읽힌다', () => {
  it('v0(키마다 따로) → 최신 버전, 값 보존', () => {
    const legacy = (JSON.parse(fixture('save-v0-legacy.json')) as { legacy: LegacyKeys }).legacy;
    const r = parseSave(null, legacy);
    expect(r.status).toBe('migrated');
    expect(r.data.v).toBe(SAVE_VERSION);
    expect(isValid(r.data)).toBe(true);
    expect(r.data.merit).toBe(120);
    expect(r.data.settings.volume.master).toBe(0.6);
    expect(r.data.settings.guide).toBe(false);
    expect(r.data.flags.guideSeen).toEqual(['move', 'firstCard']);
  });

  for (const f of V1)
    it(`${f}: 정상으로 읽히고, 게임 규칙 함수가 빠진 선택 필드를 견딘다`, () => {
      const r = parseSave(fixture(f));
      expect(r.status).toBe('ok');
      expect(isValid(r.data)).toBe(true);
      // 저장 → 다시 읽기 왕복
      expect(parseSave(serialize(r.data)).data).toEqual(r.data);
      const defs = metaData.startUpgrades as unknown as Parameters<typeof runInit>[1];
      expect(() => runInit(r.data, defs)).not.toThrow();
      expect(Array.isArray(openSlots(r.data))).toBe(true);
      const cap = applyCapture(r.data, 'S2', { victory: true, timeSec: 800, merit: 50 }, unlocksData.stages as Parameters<typeof applyCapture>[3]);
      expect(isValid(cap.save)).toBe(true);
    });

  it('손상(잘린 JSON)은 corrupt, 새 데이터로 시작', () => {
    const r = parseSave(fixture('save-corrupt.txt'));
    expect(r.status).toBe('corrupt');
    expect(isValid(r.data)).toBe(true);
  });
});

describe('백업 슬롯: 마지막 정상 세이브 복원(D43)', () => {
  beforeEach(() => resetProfile());

  it('덮어쓸 때마다 직전 정상 세이브를 백업, 복원하면 그 상태로', () => {
    const a = loadProfile();
    saveProfile({ ...a, merit: 10 } as SaveData);
    expect(hasBackup()).toBe(true);
    saveProfile({ ...loadProfile(), merit: 20 } as SaveData);
    expect(restoreBackup()).toBe(true);
    expect(loadProfile().merit).toBe(10);
  });
});
