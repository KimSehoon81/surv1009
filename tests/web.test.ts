import { describe, expect, it } from 'vitest';
import webJson from '../src/data/skillWeb.json';
import characters from '../src/data/characters.json';
import ko from '../src/i18n/ko.json';
import en from '../src/i18n/en.json';
import { addMasteryXp, buildWeb, checkUnlock, formatMod, isReachable, masteryLevel, points, resetWeb, summarize, unlockNode, webEffects, type WebData } from '../src/core/web';

const data = webJson as unknown as WebData;
const m = data.mastery;
const xpFor = (level: number) => Array.from({ length: level }, (_, n) => m.base + m.step * n).reduce((a, b) => a + b, 0);

describe('성장 지도 그래프', () => {
  it('계열마다 6갈래 × 4단계 = 24칸, 갈래 안 18줄 + 2·4단계 고리 12줄', () => {
    for (const arch of Object.keys(data.signature)) {
      const char = Object.entries(data.archetypes).find(([, a]) => a === arch)?.[0] ?? '';
      const g = buildWeb(data, char);
      expect(g.archetype).toBe(arch);
      expect(g.nodes).toHaveLength(24);
      expect(g.links).toHaveLength(30);
      expect(new Set(g.nodes.map((n) => n.id)).size).toBe(24);
    }
  });

  it('캐릭터 30명 모두 있는 계열에 속함', () => {
    const ids = Object.keys(characters.characters);
    expect(ids).toHaveLength(30);
    for (const id of ids) expect(data.signature[data.archetypes[id] ?? '']).toBeDefined();
  });

  it('1단계는 처음부터, 2단계는 안쪽 칸을 연 뒤, 고리로 옆 갈래 2단계', () => {
    const g = buildWeb(data, 'A01');
    expect(isReachable(g, [], 'fire1')).toBe(true);
    expect(isReachable(g, [], 'fire2')).toBe(false);
    expect(isReachable(g, ['fire1'], 'fire2')).toBe(true);
    expect(isReachable(g, ['fire1', 'fire2'], 'move2')).toBe(true);
    expect(isReachable(g, ['fire1', 'fire2'], 'move3')).toBe(false);
    expect(isReachable(g, [], 'nope')).toBe(false);
  });
});

describe('숙련과 포인트', () => {
  it('레벨 n → n+1에 base + step·n', () => {
    expect(masteryLevel(0, m)).toEqual({ level: 0, into: 0, need: m.base });
    expect(masteryLevel(xpFor(1), m).level).toBe(1);
    expect(masteryLevel(xpFor(3) - 1, m).level).toBe(2);
    expect(masteryLevel(1e9, m)).toEqual({ level: m.maxLevel, into: 0, need: 0 });
  });

  it('전부 여는 데 36포인트 = 숙련 Lv18', () => {
    const g = buildWeb(data, 'A01');
    expect(g.nodes.reduce((s, n) => s + n.cost, 0)).toBe(36);
    expect(36 / m.pointsPerLevel).toBe(18);
  });

  it('포인트 안에서만 열리고, 초기화하면 전부 환급', () => {
    const g = buildWeb(data, 'A01');
    let cw = addMasteryXp(undefined, xpFor(1));
    expect(points(g, cw, m)).toEqual({ total: 2, spent: 0, free: 2 });
    expect(checkUnlock(g, cw, m, 'fire2')).toBe('unreachable');
    cw = unlockNode(g, cw, m, 'fire1');
    cw = unlockNode(g, cw, m, 'fire2');
    expect(cw.nodes).toEqual(['fire1', 'fire2']);
    expect(checkUnlock(g, cw, m, 'fire1')).toBe('owned');
    expect(checkUnlock(g, cw, m, 'fire3')).toBe('points');
    expect(unlockNode(g, cw, m, 'fire3').nodes).toEqual(['fire1', 'fire2']);
    const r = resetWeb(cw);
    expect(r).toEqual({ xp: cw.xp, nodes: [] });
    expect(points(g, r, m).free).toBe(2);
  });

  it('데이터에서 사라진 칸은 비용 0이고 효과도 없음', () => {
    const g = buildWeb(data, 'A01');
    const cw = { xp: xpFor(1), nodes: ['gone9'] };
    expect(points(g, cw, m).spent).toBe(0);
    expect(webEffects(g, cw.nodes)).toEqual({ player: [], weapons: [], tp: 0, seals: 0 });
  });
});

describe('효과', () => {
  it('연 칸의 수정자를 모으고 같은 능력치는 합침', () => {
    const g = buildWeb(data, 'A01');
    const e = webEffects(g, ['fire1', 'fire2', 'fire3', 'fire4', 'supply1', 'supply2', 'supply3', 'sig1']);
    expect(e.tp).toBe(10);
    expect(e.seals).toBe(1);
    expect(e.weapons).toEqual([{ stat: 'damageMult', op: 'mul', value: 0.05 }]);
    const atk = summarize(e).find((s) => s.key === 'player.attack.mul');
    expect(atk?.value).toBeCloseTo(0.15);
  });

  it('표기: mul(더하는 비율)은 ±%, 작은 add는 %, 큰 add는 정수, 줄이는 쪽 능력치는 부호 반대', () => {
    expect(formatMod('mul', 0.05)).toBe('+5%');
    expect(formatMod('mul', -0.1)).toBe('−10%');
    expect(formatMod('add', 0.04)).toBe('+4%');
    expect(formatMod('add', 12)).toBe('+12');
    expect(formatMod('add', 1, true)).toBe('−1');
  });

  it('mul은 더하는 비율(−0.5~0.5): 1.05처럼 곱으로 적으면 +105%가 됨', () => {
    const defs = [...Object.values(data.nodes).flat(), ...Object.values(data.signature).flatMap((s) => s.nodes)];
    for (const d of defs) for (const mod of [...(d.player ?? []), ...(d.weapons ?? [])]) if (mod.op === 'mul') expect(Math.abs(mod.value), d.name).toBeLessThan(0.5);
  });

  it('쓰인 능력치마다 화면 이름(ko·en)이 있음', () => {
    const stats = new Set<string>(['tp', 'seals']);
    const defs = [...Object.values(data.nodes).flat(), ...Object.values(data.signature).flatMap((s) => s.nodes)];
    for (const d of defs) for (const mod of [...(d.player ?? []), ...(d.weapons ?? [])]) stats.add(mod.stat);
    const names = (j: unknown) => (j as { web: { stat: Record<string, string> } }).web.stat;
    for (const s of stats) {
      expect(names(ko)[s], s).toBeTruthy();
      expect(names(en)[s], s).toBeTruthy();
    }
  });
});
