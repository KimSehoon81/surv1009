// 메타 진행(PRD §8.1~§8.3): 점령 정산·해금·스타팅 포인트. Phaser 없음(테스트 대상).
// §8.1 "리셋"은 런 상태(RunStart로 새로 만들어짐), "유지"는 세이브(SaveData). 타입을 나눠 섞이지 않게 한다:
// 런은 세이브를 읽기만 하고(runInit), 세이브는 정산 함수(applyCapture·buyStartUpgrade)로만 바뀐다.

import { defaultSave, recordRun, type SaveData } from './save';

export interface UnlockEntry {
  chars: readonly string[];
  skills: readonly string[];
  cards: readonly string[];
  slot?: string;
  flags?: readonly string[];
}

export interface StartUpgradeDef {
  name: string;
  effect: string;
  maxLevel: number;
  costs: readonly number[];
  perLevel: Readonly<Record<string, number>>;
}

export type Unlock = { kind: 'char' | 'skill' | 'card' | 'slot' | 'flag'; id: string };

/** 세이브의 열린 고급 스킬 슬롯(Q는 처음부터) */
export function openSlots(save: SaveData): string[] {
  return ['Q', ...((save.unlocks as { slots?: string[] }).slots ?? [])];
}

/**
 * 판 정산: 점령 기록·전공을 세이브에 더하고, 그 지역을 처음 점령했으면 해금 스케줄을 연다.
 * 반환 unlocked는 결과 화면 "새로 해금됨" 표시용.
 */
export function applyCapture(
  save: SaveData,
  stageId: string,
  result: { victory: boolean; timeSec: number; merit: number },
  schedule: Readonly<Record<string, UnlockEntry>>,
): { save: SaveData; unlocked: Unlock[] } {
  const first = result.victory && save.stages[stageId]?.captured !== true;
  let next = recordRun(save, stageId, result.victory, result.timeSec, result.merit);
  const unlocked: Unlock[] = [];
  const e = schedule[stageId];
  if (first && e) {
    const u = next.unlocks as SaveData['unlocks'] & { slots?: string[]; flags?: string[] };
    const add = (list: readonly string[] | undefined, items: readonly string[], kind: Unlock['kind']): string[] => {
      const out = [...(list ?? [])];
      for (const id of items) {
        if (out.includes(id)) continue;
        out.push(id);
        unlocked.push({ kind, id });
      }
      return out;
    };
    next = {
      ...next,
      unlocks: {
        ...u,
        chars: add(u.chars, e.chars, 'char'),
        skills: add(u.skills, e.skills, 'skill'),
        cards: add(u.cards, e.cards, 'card'),
        ...(e.slot ? { slots: add(u.slots, [e.slot], 'slot') } : u.slots ? { slots: u.slots } : {}),
        ...(e.flags ? { flags: add(u.flags, e.flags, 'flag') } : u.flags ? { flags: u.flags } : {}),
      } as SaveData['unlocks'],
    };
  }
  return { save: next, unlocked };
}

export type BuyError = 'unknown' | 'max' | 'merit';

/** 스타팅 포인트 구매: 다음 단계 비용만큼 전공 포인트를 쓰고 단계 +1 */
export function buyStartUpgrade(save: SaveData, id: string, defs: Readonly<Record<string, StartUpgradeDef>>): { ok: true; save: SaveData } | { ok: false; error: BuyError } {
  const def = defs[id];
  if (!def) return { ok: false, error: 'unknown' };
  const lv = save.startUpgrades[id] ?? 0;
  if (lv >= def.maxLevel) return { ok: false, error: 'max' };
  const cost = def.costs[lv] ?? Infinity;
  if (save.merit < cost) return { ok: false, error: 'merit' };
  return { ok: true, save: { ...save, merit: save.merit - cost, startUpgrades: { ...save.startUpgrades, [id]: lv + 1 } } };
}

export function nextCost(save: SaveData, id: string, defs: Readonly<Record<string, StartUpgradeDef>>): number | null {
  const def = defs[id];
  const lv = save.startUpgrades[id] ?? 0;
  return def && lv < def.maxLevel ? (def.costs[lv] ?? null) : null;
}

/** 런 시작 상태(§8.1 리셋 대상: 매 판 새로 만듦). 스타팅 포인트 효과는 여기서만 계산 */
export interface RunStart {
  /** 시작 레벨(1 + 강화) */
  level: number;
  handSizeBonus: number;
  seals: number;
  /** 시작 무기 피해 +비율 */
  weaponDamageMul: number;
  tp: number;
  sealOpReduction: number;
}

export function runInit(save: SaveData, defs: Readonly<Record<string, StartUpgradeDef>>): RunStart {
  const sum = (key: string): number =>
    Object.entries(defs).reduce((acc, [id, def]) => acc + (save.startUpgrades[id] ?? 0) * (def.perLevel[key] ?? 0), 0);
  return {
    level: 1 + sum('levels'),
    handSizeBonus: sum('handSize'),
    seals: sum('seals'),
    weaponDamageMul: sum('damageMul'),
    tp: sum('tp'),
    sealOpReduction: sum('sealOpReduction'),
  };
}

/** 새 세이브 + 해금 상태(테스트·뉴게임용) */
export function freshSave(): SaveData {
  return defaultSave();
}
