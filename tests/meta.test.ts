import { describe, expect, it } from 'vitest';
import unlocksData from '../src/data/unlocks.json';
import metaData from '../src/data/meta.json';
import skillsData from '../src/data/skills.json';
import { applyCapture, buyStartUpgrade, nextCost, openSlots, runInit, type StartUpgradeDef, type UnlockEntry } from '../src/core/meta';
import { defaultSave, isValid, parseSave, serialize } from '../src/core/save';

const SCHED = unlocksData.stages as Record<string, UnlockEntry>;
const DEFS = metaData.startUpgrades as Record<string, StartUpgradeDef>;

describe('해금 스케줄', () => {
  it('S1~S9 점령마다 캐릭터 3명 → 30명, 슬롯 E·R·F는 S2·S4·S7, S10은 엔딩', () => {
    let s = defaultSave();
    const slotsAt: Record<string, string[]> = {};
    for (let i = 1; i <= 10; i++) {
      const r = applyCapture(s, `S${i}`, { victory: true, timeSec: 800, merit: 100 }, SCHED);
      s = r.save;
      expect(r.unlocked.filter((u) => u.kind === 'char'), `S${i}`).toHaveLength(i <= 9 ? 3 : 0);
      slotsAt[`S${i}`] = openSlots(s);
    }
    expect(s.unlocks.chars).toHaveLength(30);
    expect(slotsAt.S1).toEqual(['Q']);
    expect(slotsAt.S2).toEqual(['Q', 'E']);
    expect(slotsAt.S3).toEqual(['Q', 'E']);
    expect(slotsAt.S4).toEqual(['Q', 'E', 'R']);
    expect(slotsAt.S7).toEqual(['Q', 'E', 'R', 'F']);
    expect((s.unlocks as { flags?: string[] }).flags).toContain('ending');
    // 고급 스킬 12종 모두 해금(시작 AS03 + 지역 보상)
    expect([...s.unlocks.skills].sort()).toEqual(Object.keys(skillsData.skills).sort());
    expect(isValid(parseSave(serialize(s)).data)).toBe(true);
  });

  it('해금은 처음 점령할 때만, 패배는 기록만', () => {
    const lose = applyCapture(defaultSave(), 'S1', { victory: false, timeSec: 300, merit: 20 }, SCHED);
    expect(lose.unlocked).toEqual([]);
    expect(lose.save.merit).toBe(20);
    const win = applyCapture(lose.save, 'S1', { victory: true, timeSec: 800, merit: 300 }, SCHED);
    expect(win.unlocked.map((u) => u.kind)).toEqual(['char', 'char', 'char', 'skill', 'card']);
    const again = applyCapture(win.save, 'S1', { victory: true, timeSec: 700, merit: 300 }, SCHED);
    expect(again.unlocked).toEqual([]);
    expect(again.save.stages.S1).toMatchObject({ clears: 2, bestTimeSec: 700 });
  });

  it('스킬 해금 지역이 skills.json의 unlock 표기와 일치', () => {
    for (const [id, sk] of Object.entries(skillsData.skills)) {
      if (sk.unlock === '시작') continue;
      const stage = sk.unlock.split(' ')[0] as string;
      expect(SCHED[stage]?.skills, id).toContain(id);
    }
  });
});

describe('스타팅 포인트', () => {
  it('비용만큼 전공을 쓰고 단계가 오르며, 최대 단계·전공 부족이면 거절', () => {
    let s = { ...defaultSave(), merit: 1000 };
    const c1 = nextCost(s, 'startLevel', DEFS) ?? 0;
    let r = buyStartUpgrade(s, 'startLevel', DEFS);
    expect(r.ok).toBe(true);
    if (r.ok) s = r.save;
    expect(s.merit).toBe(1000 - c1);
    r = buyStartUpgrade(s, 'startLevel', DEFS);
    if (r.ok) s = r.save;
    expect(s.startUpgrades.startLevel).toBe(2);
    expect(buyStartUpgrade(s, 'startLevel', DEFS)).toEqual({ ok: false, error: 'max' });
    expect(buyStartUpgrade({ ...defaultSave(), merit: 10 }, 'startSeal', DEFS)).toEqual({ ok: false, error: 'merit' });
    expect(buyStartUpgrade(s, 'nope', DEFS)).toEqual({ ok: false, error: 'unknown' });
  });

  it('런 시작 상태는 runInit 한곳에서: 6항목 최대치 반영, 강화 없으면 기본값', () => {
    expect(runInit(defaultSave(), DEFS)).toEqual({ level: 1, handSizeBonus: 0, seals: 0, weaponDamageMul: 0, tp: 0, sealOpReduction: 0 });
    const maxed = { ...defaultSave(), startUpgrades: Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, d.maxLevel])) };
    const r = runInit(maxed, DEFS);
    expect(r).toEqual({ level: 3, handSizeBonus: 1, seals: 1, weaponDamageMul: 0.3, tp: 30, sealOpReduction: 2 });
  });
});
