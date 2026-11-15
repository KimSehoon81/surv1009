import { describe, expect, it } from 'vitest';
import webJson from '../src/data/skillWeb.json';
import characters from '../src/data/characters.json';
import ko from '../src/i18n/ko.json';
import en from '../src/i18n/en.json';
import {
  addMasteryXp,
  bridgeId,
  buildWeb,
  capstones,
  checkUnlock,
  formatMod,
  isReachable,
  isStale,
  masteryLevel,
  ownedNodes,
  points,
  resetWeb,
  summarize,
  unlockNode,
  webEffects,
  type CharWeb,
  type WebData,
} from '../src/core/web';

const data = webJson as unknown as WebData;
const m = data.mastery;
const V = data.version;
const xpFor = (level: number) => Array.from({ length: level }, (_, n) => m.base + m.step * n).reduce((a, b) => a + b, 0);
const web = (level: number, nodes: string[] = []): CharWeb => ({ xp: xpFor(level), nodes, v: V });

describe('성장 지도 그래프(v2)', () => {
  it('계열마다 6갈래 × 5단계 + 연결 칸 6 = 36칸, 5단계는 정점', () => {
    for (const arch of Object.keys(data.signature)) {
      const char = Object.entries(data.archetypes).find(([, a]) => a === arch)?.[0] ?? '';
      const g = buildWeb(data, char);
      expect(g.archetype).toBe(arch);
      expect(g.nodes).toHaveLength(36);
      expect(new Set(g.nodes.map((n) => n.id)).size).toBe(36);
      expect(g.nodes.filter((n) => n.kind === 'bridge')).toHaveLength(6);
      expect(g.nodes.filter((n) => n.capstone).map((n) => n.ring)).toEqual([5, 5, 5, 5, 5, 5]);
      // 갈래 안 4줄 × 6 + 고리(ringLinks) 6
      expect(g.links).toHaveLength(24 + 6 * data.ringLinks.length);
    }
  });

  it('캐릭터 30명 모두 있는 계열에 속함', () => {
    const ids = Object.keys(characters.characters);
    expect(ids).toHaveLength(30);
    for (const id of ids) expect(data.signature[data.archetypes[id] ?? '']).toBeDefined();
  });

  it('비용은 단계마다 오르고(1·2·3·4·6), 관문 레벨도 바깥일수록 높음', () => {
    const g = buildWeb(data, 'A01');
    const fire = [1, 2, 3, 4, 5].map((r) => g.nodes.find((n) => n.id === `fire${r}`));
    expect(fire.map((n) => n?.cost)).toEqual([1, 2, 3, 4, 6]);
    expect(fire.map((n) => n?.level)).toEqual(data.levelGates.slice(1));
    for (let r = 2; r <= 5; r++) expect(data.levelGates[r]).toBeGreaterThan(data.levelGates[r - 1] ?? -1);
    expect(g.nodes.find((n) => n.kind === 'bridge')?.cost).toBe(data.bridgeCost);
  });

  it('1단계는 처음부터, 2단계는 안쪽 칸을 연 뒤, 4단계는 옆 갈래 4단계에서도 이어짐', () => {
    const g = buildWeb(data, 'A01');
    expect(isReachable(g, [], 'fire1')).toBe(true);
    expect(isReachable(g, [], 'fire2')).toBe(false);
    expect(isReachable(g, ['fire1'], 'fire2')).toBe(true);
    // v1의 2단계 고리는 없어짐(연결 칸으로 바뀜)
    expect(isReachable(g, ['fire1', 'fire2'], 'move2')).toBe(false);
    expect(isReachable(g, ['fire4'], 'move4')).toBe(true);
    expect(isReachable(g, [], 'nope')).toBe(false);
  });

  it('연결 칸은 양쪽 갈래의 2단계를 모두 열어야 함', () => {
    const g = buildWeb(data, 'A01');
    const id = bridgeId('fire', 'move');
    expect(g.nodes.find((n) => n.id === id)?.all).toEqual(['fire2', 'move2']);
    expect(isReachable(g, ['fire1', 'fire2'], id)).toBe(false);
    expect(isReachable(g, ['fire1', 'fire2', 'move1'], id)).toBe(false);
    expect(isReachable(g, ['fire1', 'fire2', 'move1', 'move2'], id)).toBe(true);
    // 마지막 갈래와 첫 갈래 사이에도 있음
    expect(g.nodes.some((n) => n.id === bridgeId('guard', 'sig'))).toBe(true);
  });
});

describe('숙련과 포인트', () => {
  it('레벨 n → n+1에 base + step·n (v1보다 느림)', () => {
    expect(masteryLevel(0, m)).toEqual({ level: 0, into: 0, need: m.base });
    expect(masteryLevel(xpFor(1), m).level).toBe(1);
    expect(masteryLevel(xpFor(3) - 1, m).level).toBe(2);
    expect(masteryLevel(1e9, m)).toEqual({ level: m.maxLevel, into: 0, need: 0 });
    expect(m.base).toBeGreaterThanOrEqual(60);
    expect(m.step).toBeGreaterThanOrEqual(30);
  });

  it('전부는 못 엶: 정점 제한 안에서 쓸 수 있는 최대가 최대 레벨 포인트보다 많음', () => {
    const g = buildWeb(data, 'A01');
    const all = g.nodes.reduce((s, n) => s + n.cost, 0);
    expect(all).toBe(6 * 16 + 6 * data.bridgeCost);
    const capCost = g.nodes.find((n) => n.capstone)?.cost ?? 0;
    const spendable = all - (6 - data.capstoneLimit) * capCost;
    expect(spendable).toBeGreaterThan(m.maxLevel * m.pointsPerLevel);
  });

  it('숙련 레벨 관문: 포인트가 있어도 레벨이 모자라면 못 엶', () => {
    const g = buildWeb(data, 'A01');
    const gate3 = data.levelGates[3] ?? 0;
    // 관문 직전 레벨: 1·2단계는 열리고 3단계는 level
    let cw = web(gate3 - 1);
    cw = unlockNode(g, cw, m, 'fire1');
    cw = unlockNode(g, cw, m, 'fire2');
    expect(cw.nodes).toEqual(['fire1', 'fire2']);
    expect(points(g, cw, m).free).toBeGreaterThanOrEqual(3);
    expect(checkUnlock(g, cw, m, 'fire3')).toBe('level');
    expect(checkUnlock(g, { ...cw, xp: xpFor(gate3) }, m, 'fire3')).toBe('ok');
    // 2단계도 레벨 관문이 있음
    expect(checkUnlock(g, web(1, ['fire1']), m, 'fire2')).toBe('level');
  });

  it('포인트 안에서만 열리고, 초기화하면 전부 환급', () => {
    const g = buildWeb(data, 'A01');
    let cw = web(2);
    expect(points(g, cw, m)).toEqual({ total: 4, spent: 0, free: 4 });
    expect(checkUnlock(g, cw, m, 'fire2')).toBe('unreachable');
    cw = unlockNode(g, cw, m, 'fire1');
    cw = unlockNode(g, cw, m, 'fire2');
    expect(checkUnlock(g, cw, m, 'fire1')).toBe('owned');
    expect(points(g, cw, m).free).toBe(1);
    expect(checkUnlock(g, cw, m, 'move1')).toBe('ok');
    cw = unlockNode(g, cw, m, 'move1');
    expect(checkUnlock(g, cw, m, 'guard1')).toBe('points');
    expect(unlockNode(g, cw, m, 'guard1').nodes).toEqual(['fire1', 'fire2', 'move1']);
    const r = resetWeb(g, cw);
    expect(r).toEqual({ xp: cw.xp, nodes: [], v: V });
    expect(points(g, r, m).free).toBe(4);
  });

  it('정점은 캐릭터당 capstoneLimit개까지', () => {
    const g = buildWeb(data, 'A01');
    const branch = (b: string) => [1, 2, 3, 4].map((r) => `${b}${r}`);
    const base = [...branch('fire'), ...branch('move'), ...branch('guard')];
    let cw = web(m.maxLevel, base);
    cw = unlockNode(g, cw, m, 'fire5');
    cw = unlockNode(g, cw, m, 'move5');
    expect(capstones(g, cw.nodes)).toBe(2);
    expect(data.capstoneLimit).toBe(2);
    expect(checkUnlock(g, cw, m, 'guard5')).toBe('limit');
    expect(unlockNode(g, cw, m, 'guard5').nodes).not.toContain('guard5');
  });

  it('규칙 판이 다른 저장(v1)은 칸이 없는 것으로 보고 포인트를 돌려줌, 경험치는 그대로', () => {
    const g = buildWeb(data, 'A01');
    const old: CharWeb = { xp: xpFor(6), nodes: ['fire1', 'fire2', 'sig1', 'sig2', 'sig3', 'sig4'] };
    expect(isStale(g, old)).toBe(true);
    expect(ownedNodes(g, old)).toEqual([]);
    expect(points(g, old, m)).toEqual({ total: 12, spent: 0, free: 12 });
    expect(webEffects(g, ownedNodes(g, old))).toEqual({ player: [], weapons: [], tp: 0, seals: 0 });
    // 새로 찍으면 지금 판으로 저장되고, 경험치를 더해도 판은 유지
    const cw = unlockNode(g, old, m, 'fire1');
    expect(cw).toEqual({ xp: old.xp, nodes: ['fire1'], v: V });
    expect(addMasteryXp(cw, 50)).toEqual({ xp: old.xp + 50, nodes: ['fire1'], v: V });
    expect(isStale(g, cw)).toBe(false);
    expect(isStale(g, { xp: 10, nodes: [] })).toBe(false);
  });

  it('데이터에서 사라진 칸은 비용 0이고 효과도 없음', () => {
    const g = buildWeb(data, 'A01');
    const cw = web(1, ['gone9']);
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

  it('연결 칸과 정점도 효과가 있음', () => {
    const g = buildWeb(data, 'A01');
    for (const n of g.nodes.filter((x) => x.kind === 'bridge' || x.capstone)) {
      const e = webEffects(g, [n.id]);
      expect(e.player.length + e.weapons.length + e.tp + e.seals, n.id).toBeGreaterThan(0);
    }
  });

  it('표기: mul(더하는 비율)은 ±%, 작은 add는 %, 큰 add는 정수, 줄이는 쪽 능력치는 부호 반대', () => {
    expect(formatMod('mul', 0.05)).toBe('+5%');
    expect(formatMod('mul', -0.1)).toBe('−10%');
    expect(formatMod('add', 0.04)).toBe('+4%');
    expect(formatMod('add', 12)).toBe('+12');
    expect(formatMod('add', 1, true)).toBe('−1');
  });

  const defs = [...Object.values(data.nodes).flat(), ...Object.values(data.signature).flatMap((s) => s.nodes), ...data.bridges];

  it('mul은 더하는 비율(−0.5~0.5): 1.05처럼 곱으로 적으면 +105%가 됨', () => {
    for (const d of defs) for (const mod of [...(d.player ?? []), ...(d.weapons ?? [])]) if (mod.op === 'mul') expect(Math.abs(mod.value), d.name).toBeLessThan(0.5);
  });

  it('쓰인 능력치마다 화면 이름(ko·en)이 있음', () => {
    const stats = new Set<string>(['tp', 'seals']);
    for (const d of defs) for (const mod of [...(d.player ?? []), ...(d.weapons ?? [])]) stats.add(mod.stat);
    const names = (j: unknown) => (j as { web: { stat: Record<string, string> } }).web.stat;
    for (const s of stats) {
      expect(names(ko)[s], s).toBeTruthy();
      expect(names(en)[s], s).toBeTruthy();
    }
  });

  it('못 여는 까닭마다 문구(ko·en)가 있음', () => {
    const why = (j: unknown) => (j as { web: { why: Record<string, string> } }).web.why;
    for (const k of ['owned', 'unreachable', 'level', 'limit', 'points', 'missing']) {
      expect(why(ko)[k], k).toBeTruthy();
      expect(why(en)[k], k).toBeTruthy();
    }
  });
});
