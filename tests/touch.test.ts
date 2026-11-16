import { describe, expect, it } from 'vitest';
import { actionsForButton, clampStick, stickVector, toView, toViewDelta, viewLayout } from '../src/core/touch';
import { closeOver, collectIds } from '../src/core/unitNeeds';
import controls from '../src/data/controls.json';
import touchData from '../src/data/touch.json';
import ko from '../src/i18n/ko.json';
import en from '../src/i18n/en.json';
import stagesData from '../src/data/stages.json';
import enemiesData from '../src/data/enemies.json';
import npcData from '../src/data/npcs.json';

describe('터치 조작(모바일)', () => {
  it('조이스틱: 손떨림 구간은 0, 끝까지 밀면 길이 1, 방향 유지', () => {
    expect(stickVector(3, 0, 50, 0.15)).toEqual({ x: 0, y: 0 });
    const full = stickVector(200, 0, 50, 0.15);
    expect(full.x).toBeCloseTo(1);
    expect(full.y).toBeCloseTo(0);
    const half = stickVector(0, -(50 * 0.15 + 50 * 0.85 * 0.5), 50, 0.15);
    expect(half.y).toBeCloseTo(-0.5);
    const diag = stickVector(100, 100, 50, 0.15);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
    expect(clampStick(300, 400, 50)).toEqual({ x: 30, y: 40 });
    expect(clampStick(3, 4, 50)).toEqual({ x: 3, y: 4 });
  });

  it('세로로 든 터치 기기만 돌림(가로·세로를 바꿔 씀), PC 창은 그대로', () => {
    expect(viewLayout(390, 844, true)).toEqual({ rotated: true, width: 844, height: 390 });
    expect(viewLayout(844, 390, true)).toEqual({ rotated: false, width: 844, height: 390 });
    expect(viewLayout(600, 900, false)).toEqual({ rotated: false, width: 600, height: 900 });
  });

  it('돌린 화면의 좌표: 창의 오른쪽 위 = 게임의 왼쪽 위, 창에서 아래로 = 게임에서 오른쪽', () => {
    expect(toView(390, 0, 390, true)).toEqual({ x: 0, y: 0 });
    expect(toView(0, 844, 390, true)).toEqual({ x: 844, y: 390 });
    expect(toView(10, 20, 390, false)).toEqual({ x: 10, y: 20 });
    expect(toViewDelta(0, 30, true)).toEqual({ x: 30, y: -0 });
    expect(toViewDelta(-30, 0, true)).toEqual({ x: 0, y: 30 });
    expect(toViewDelta(5, 7, false)).toEqual({ x: 5, y: 7 });
  });

  it('메뉴 버튼은 패드와 같은 액션을 누름(확인 = A, 뒤로 = B, 길게 누르기 묶음 제외)', () => {
    const a = actionsForButton(controls.pad, 'A');
    expect(a).toEqual(expect.arrayContaining(['uiConfirm', 'levelConfirm', 'redeploy']));
    expect(actionsForButton(controls.pad, 'B')).toEqual(expect.arrayContaining(['uiBack', 'toMap']));
    expect(actionsForButton(controls.pad, 'DLeft')).toEqual(expect.arrayContaining(['uiLeft', 'levelPrev']));
    expect(actionsForButton(controls.pad, 'Y')).not.toContain('cardSealSubmit');
  });

  it('touch.json: 버튼의 액션·패드 버튼이 controls.json에 있고, 글자(@키)가 두 언어에 있음', () => {
    const keys = controls.keys as Record<string, unknown>;
    const padButtons = new Set(Object.values(controls.pad).flat());
    const look = (dict: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
    const labels: string[] = [...Object.values(touchData.labels)];
    for (const b of [...touchData.battle, ...touchData.menu] as { act?: string; acts?: string[]; pad?: string; label: string }[]) {
      for (const act of [...(b.acts ?? []), ...(b.act ? [b.act] : [])]) expect(keys[act], act).toBeDefined();
      if (b.pad) expect(padButtons.has(b.pad), b.pad).toBe(true);
      expect(b.act || b.acts || b.pad, b.label).toBeTruthy();
      labels.push(b.label);
    }
    for (const act of Object.keys(touchData.labels)) expect(keys[act], act).toBeDefined();
    for (const l of labels.filter((s) => s.startsWith('@'))) {
      expect(typeof look(ko, l.slice(1)), l).toBe('string');
      expect(typeof look(en, l.slice(1)), l).toBe('string');
    }
    // 전투 버튼: 스킬 4칸 + 질주 + 카드 제출·인장 + 일시정지
    expect(touchData.battle.map((b) => b.act)).toEqual(expect.arrayContaining(['sprint', 'skillQ', 'skillE', 'skillR', 'skillF', 'cardSubmit', 'cardSealSubmit', 'pause']));
  });
});

describe('전투에 필요한 유닛 찾기(그림을 필요한 만큼만 올림)', () => {
  const defs: Record<string, unknown> = { ...enemiesData.enemies, ...npcData.npcs };
  const looks = Object.values(enemiesData.enemies as Record<string, { looks?: string[] }>).flatMap((e) => e.looks ?? []);
  const known = new Set([...Object.keys(defs), ...looks]);

  it('키와 값 어디에 있든 모으고, 모르는 문자열은 무시', () => {
    const k = new Set(['E01', 'E02', 'E03']);
    expect([...collectIds({ a: 'E01', list: [{ enemy: 'E02' }, 'X9'], E03: 2, n: 5 }, k)].sort()).toEqual(['E01', 'E02', 'E03']);
  });

  it('유닛이 부르는 유닛(소환·겉모습 변형)까지 따라감, 돌고 도는 참조에도 끝남', () => {
    const d = { E01: { looks: ['E51'] }, E02: { summon: { enemy: 'E03' } }, E03: { summon: 'E02' } };
    const k = new Set(['E01', 'E02', 'E03', 'E51']);
    expect(closeOver(['E01'], d, k).sort()).toEqual(['E01', 'E51']);
    expect(closeOver(['E02'], d, k).sort()).toEqual(['E02', 'E03']);
  });

  it('모든 지역: 보스·엘리트·구간 적이 필요 목록에 들어가고, 전체 유닛보다 훨씬 적음', () => {
    for (const [key, st] of Object.entries(stagesData.stages as Record<string, { boss: { enemy: string }; phases: { spawns: { enemy: string }[] }[] }>)) {
      const ids = new Set(closeOver(collectIds(st, known), defs, known));
      expect(ids.has(st.boss.enemy), `${key} boss`).toBe(true);
      for (const ph of st.phases) for (const sp of ph.spawns) expect(ids.has(sp.enemy), `${key} ${sp.enemy}`).toBe(true);
      expect(ids.size, key).toBeLessThan(known.size * 0.6);
    }
  });
});
