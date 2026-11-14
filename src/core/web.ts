// 성장 지도(거미줄형 캐릭터 성장, 2026-11-14): 칸 그래프·개방 규칙·숙련 레벨·효과 합산. Phaser 없음
import type { StatMod } from './stats';

export interface WebNodeDef {
  name: string;
  /** 플레이어 능력치 수정자 */
  player?: StatMod[];
  /** 시작 무기 전부에 거는 수정자(그 능력치가 없는 무기는 영향 없음) */
  weapons?: StatMod[];
  /** 출정 시 바로 받는 것 */
  start?: { tp?: number; seals?: number };
}
export interface WebBranch {
  id: string;
  name: string;
  color: string;
  angle: number;
}
export interface MasteryCurve {
  base: number;
  step: number;
  pointsPerLevel: number;
  maxLevel: number;
}
export interface WebData {
  mastery: MasteryCurve;
  costs: number[];
  ringLinks: number[];
  branches: WebBranch[];
  nodes: Record<string, WebNodeDef[]>;
  signature: Record<string, { name: string; nodes: WebNodeDef[] }>;
  archetypes: Record<string, string>;
}
export interface WebNode extends WebNodeDef {
  id: string;
  branch: string;
  ring: number;
  cost: number;
}
export interface WebGraph {
  nodes: WebNode[];
  links: [string, string][];
  archetype: string;
}
/** 저장: 캐릭터별 숙련 경험치와 연 칸 */
export interface CharWeb {
  xp: number;
  nodes: string[];
}

/** 고유 갈래 id(내용은 캐릭터 계열마다 다름) */
export const SIGNATURE = 'sig';

export function archetypeOf(data: WebData, char: string): string {
  return data.archetypes[char] ?? Object.keys(data.signature)[0] ?? '';
}

/** 캐릭터의 거미줄: 갈래마다 1~4단계 칸, 같은 갈래는 안→밖, ringLinks 단계는 옆 갈래와 고리 */
export function buildWeb(data: WebData, char: string): WebGraph {
  const archetype = archetypeOf(data, char);
  const nodes: WebNode[] = [];
  const links: [string, string][] = [];
  const last = data.costs[data.costs.length - 1] ?? 1;
  for (const b of data.branches) {
    const defs = b.id === SIGNATURE ? (data.signature[archetype]?.nodes ?? []) : (data.nodes[b.id] ?? []);
    defs.forEach((d, i) => {
      const ring = i + 1;
      nodes.push({ ...d, id: `${b.id}${ring}`, branch: b.id, ring, cost: data.costs[i] ?? last });
      if (ring > 1) links.push([`${b.id}${ring - 1}`, `${b.id}${ring}`]);
    });
  }
  const has = new Set(nodes.map((n) => n.id));
  for (const ring of data.ringLinks) {
    data.branches.forEach((b, i) => {
      const nb = data.branches[(i + 1) % data.branches.length];
      if (!nb || nb === b) return;
      const a = `${b.id}${ring}`;
      const c = `${nb.id}${ring}`;
      if (has.has(a) && has.has(c)) links.push([a, c]);
    });
  }
  return { nodes, links, archetype };
}

export function neighbors(g: WebGraph, id: string): string[] {
  return g.links.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
}

/** 열 수 있는 자리: 1단계(가운데와 이어짐)거나 이어진 칸 하나가 열려 있음 */
export function isReachable(g: WebGraph, owned: readonly string[], id: string): boolean {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return false;
  return n.ring === 1 || neighbors(g, id).some((x) => owned.includes(x));
}

/** 숙련 레벨: 레벨 n → n+1에 base + step·n 경험치 */
export function masteryLevel(xp: number, m: MasteryCurve): { level: number; into: number; need: number } {
  let level = 0;
  let left = Math.max(0, xp);
  while (level < m.maxLevel) {
    const need = m.base + m.step * level;
    if (left < need) return { level, into: left, need };
    left -= need;
    level++;
  }
  return { level, into: 0, need: 0 };
}

export function points(g: WebGraph, cw: CharWeb | undefined, m: MasteryCurve): { total: number; spent: number; free: number } {
  const total = masteryLevel(cw?.xp ?? 0, m).level * m.pointsPerLevel;
  // 데이터에서 사라진 칸은 비용 0(포인트 자동 환급)
  const spent = (cw?.nodes ?? []).reduce((s, id) => s + (g.nodes.find((n) => n.id === id)?.cost ?? 0), 0);
  return { total, spent, free: total - spent };
}

export type UnlockCheck = 'ok' | 'owned' | 'unreachable' | 'points' | 'missing';

export function checkUnlock(g: WebGraph, cw: CharWeb | undefined, m: MasteryCurve, id: string): UnlockCheck {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return 'missing';
  const owned = cw?.nodes ?? [];
  if (owned.includes(id)) return 'owned';
  if (!isReachable(g, owned, id)) return 'unreachable';
  if (points(g, cw, m).free < n.cost) return 'points';
  return 'ok';
}

/** 칸 열기(못 열면 그대로 돌려줌) */
export function unlockNode(g: WebGraph, cw: CharWeb | undefined, m: MasteryCurve, id: string): CharWeb {
  const base: CharWeb = { xp: cw?.xp ?? 0, nodes: [...(cw?.nodes ?? [])] };
  if (checkUnlock(g, cw, m, id) !== 'ok') return base;
  return { ...base, nodes: [...base.nodes, id] };
}

/** 초기화: 연 칸을 모두 되돌림(포인트 전부 환급, 경험치 유지) */
export function resetWeb(cw: CharWeb | undefined): CharWeb {
  return { xp: cw?.xp ?? 0, nodes: [] };
}

/** 한 판 정산: 그 캐릭터의 숙련 경험치 += 이번 판 전공 */
export function addMasteryXp(cw: CharWeb | undefined, xp: number): CharWeb {
  return { xp: (cw?.xp ?? 0) + Math.max(0, Math.round(xp)), nodes: [...(cw?.nodes ?? [])] };
}

export interface WebEffects {
  player: StatMod[];
  weapons: StatMod[];
  tp: number;
  seals: number;
}

/** 연 칸의 효과를 모음(출정 시 적용) */
export function webEffects(g: WebGraph, owned: readonly string[]): WebEffects {
  const out: WebEffects = { player: [], weapons: [], tp: 0, seals: 0 };
  for (const n of g.nodes) {
    if (!owned.includes(n.id)) continue;
    out.player.push(...(n.player ?? []));
    out.weapons.push(...(n.weapons ?? []));
    out.tp += n.start?.tp ?? 0;
    out.seals += n.start?.seals ?? 0;
  }
  return out;
}

/** 화면용 합계: 같은 능력치·연산끼리 더함(mul도 core/stats처럼 더하는 비율). 키 = player.attack.mul · weapons.damageMult.mul · start.tp.add */
export function summarize(e: WebEffects): { key: string; stat: string; op: 'add' | 'mul'; value: number }[] {
  const map = new Map<string, { key: string; stat: string; op: 'add' | 'mul'; value: number }>();
  const put = (scope: string, m: StatMod) => {
    const key = `${scope}.${m.stat}.${m.op}`;
    const cur = map.get(key);
    if (cur) cur.value += m.value;
    else map.set(key, { key, stat: m.stat, op: m.op, value: m.value });
  };
  e.player.forEach((m) => put('player', m));
  e.weapons.forEach((m) => put('weapons', m));
  if (e.tp) put('start', { stat: 'tp', op: 'add', value: e.tp });
  if (e.seals) put('start', { stat: 'seals', op: 'add', value: e.seals });
  return [...map.values()];
}

/** 수치 표기: mul(더하는 비율) → ±%, 1보다 작은 add → %, 그 밖의 add → 정수. 줄이는 쪽이 좋은 능력치(inverse)는 부호를 뒤집어 보여 줌 */
export function formatMod(op: 'add' | 'mul', value: number, inverse = false): string {
  let v: number;
  let unit = '';
  if (op === 'mul' || Math.abs(value) < 1) {
    v = Math.round(value * 100);
    unit = '%';
  } else v = Math.round(value);
  if (inverse) v = -v;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)}${unit}`;
}
