// 세이브 스키마(PRD §12: 점령 지역·해금·전공 포인트·스타팅 포인트 강화)와 마이그레이션·손상 복구. Phaser 없음(테스트 대상).
// 저장소 접근은 systems/save가 맡고, 여기는 문자열 ↔ 데이터 변환 규칙만.

export const SAVE_VERSION = 1;

export interface StageRecord {
  captured: boolean;
  /** 가장 빠른 점령 시간(초) */
  bestTimeSec?: number;
  clears: number;
}

export interface SaveData {
  v: number;
  stages: Record<string, StageRecord>;
  unlocks: { chars: string[]; skills: string[]; cards?: string[]; slots?: string[]; flags?: string[] };
  /** 마지막 출정 구성(출정 준비 화면이 다음에 그대로 보여 줌) */
  loadout?: Loadout;
  /** 덱 프리셋(1칸) */
  deckPreset?: string[];
  merit: number;
  /** 스타팅 포인트 강화 단계(D19) */
  startUpgrades: Record<string, number>;
  settings: {
    volume: { master: number; bgm: number; sfx: number; ui: number };
    guide: boolean;
  };
  flags: {
    guideSeen: string[];
    firstRunDone: boolean;
    /** 보스 진입 순간 런 상태(보스 재도전 1회 기반, D19) */
    bossCheckpoint?: unknown;
  };
}

export interface Loadout {
  char: string;
  deck: string[];
  /** 슬롯 키(Q·E·R·F) → 스킬 ID */
  skills: Record<string, string | null>;
}

export function defaultSave(): SaveData {
  return {
    v: SAVE_VERSION,
    stages: {},
    unlocks: { chars: ['A01', 'A02', 'A03'], skills: ['AS03'] },
    merit: 0,
    startUpgrades: {},
    settings: { volume: { master: 1, bgm: 1, sfx: 1, ui: 1 }, guide: true },
    flags: { guideSeen: [], firstRunDone: false },
  };
}

/** 예전 저장(v0: 키마다 따로 저장하던 D14~D16) */
export interface LegacyKeys {
  guide?: { enabled?: boolean; seen?: string[] } | null;
  firstRunDone?: boolean | null;
  volume?: Partial<SaveData['settings']['volume']> | null;
  merit?: number | null;
}

/** 버전 v → v+1 변환 표. 새 버전을 만들면 여기에 한 줄 추가 */
export const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {
  0: (d) => {
    const legacy = (d.legacy ?? {}) as LegacyKeys;
    const base = defaultSave();
    return {
      ...base,
      merit: typeof legacy.merit === 'number' ? legacy.merit : 0,
      settings: { volume: { ...base.settings.volume, ...(legacy.volume ?? {}) }, guide: legacy.guide?.enabled ?? true },
      flags: { guideSeen: legacy.guide?.seen ?? [], firstRunDone: legacy.firstRunDone === true },
      v: 1,
    };
  },
};

export function migrate(d: Record<string, unknown>): Record<string, unknown> {
  let cur = d;
  let v = typeof cur.v === 'number' ? cur.v : 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`세이브 마이그레이션 없음: v${v}`);
    cur = step(cur);
    v = typeof cur.v === 'number' ? cur.v : v + 1;
  }
  return cur;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 필수 필드 검사(형태가 맞지 않으면 손상으로 본다) */
export function isValid(d: unknown): d is SaveData {
  if (!isObj(d)) return false;
  const s = d.settings;
  const f = d.flags;
  const u = d.unlocks;
  return (
    typeof d.v === 'number' &&
    isObj(d.stages) &&
    typeof d.merit === 'number' &&
    Number.isFinite(d.merit) &&
    isObj(d.startUpgrades) &&
    isObj(u) &&
    Array.isArray(u.chars) &&
    Array.isArray(u.skills) &&
    isObj(s) &&
    isObj(s.volume) &&
    typeof s.guide === 'boolean' &&
    isObj(f) &&
    Array.isArray(f.guideSeen) &&
    typeof f.firstRunDone === 'boolean'
  );
}

export type LoadResult = { data: SaveData; status: 'new' | 'ok' | 'migrated' | 'corrupt' };

/**
 * 저장 문자열 → 데이터. 없으면 예전 키(legacy)로 v0 마이그레이션, 파싱 실패·필수 필드 누락이면 손상(corrupt):
 * 호출부는 원본을 백업 키에 보관하고 새 데이터로 시작한다.
 */
export function parseSave(text: string | null, legacy?: LegacyKeys): LoadResult {
  if (text === null) {
    const hasLegacy = legacy && Object.values(legacy).some((x) => x !== null && x !== undefined);
    if (!hasLegacy) return { data: defaultSave(), status: 'new' };
    return { data: migrate({ v: 0, legacy }) as unknown as SaveData, status: 'migrated' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { data: defaultSave(), status: 'corrupt' };
  }
  if (!isObj(raw)) return { data: defaultSave(), status: 'corrupt' };
  try {
    const before = typeof raw.v === 'number' ? raw.v : 0;
    const d = migrate(raw);
    if (!isValid(d)) return { data: defaultSave(), status: 'corrupt' };
    return { data: d, status: before < SAVE_VERSION ? 'migrated' : 'ok' };
  } catch {
    return { data: defaultSave(), status: 'corrupt' };
  }
}

export function serialize(d: SaveData): string {
  return JSON.stringify(d);
}

/** 점령 기록(결과 화면) */
export function recordRun(d: SaveData, stage: string, victory: boolean, timeSec: number, merit: number): SaveData {
  const prev = d.stages[stage] ?? { captured: false, clears: 0 };
  const rec: StageRecord = {
    captured: prev.captured || victory,
    clears: prev.clears + (victory ? 1 : 0),
    ...(victory ? { bestTimeSec: Math.min(prev.bestTimeSec ?? Infinity, Math.round(timeSec)) } : prev.bestTimeSec !== undefined ? { bestTimeSec: prev.bestTimeSec } : {}),
  };
  return { ...d, merit: d.merit + merit, stages: { ...d.stages, [stage]: rec } };
}

/** 지도: n번째 지역(0부터)은 앞 지역을 점령해야 열린다 */
export function isUnlocked(d: SaveData, order: readonly string[], stage: string): boolean {
  const i = order.indexOf(stage);
  if (i <= 0) return i === 0;
  return d.stages[order[i - 1] as string]?.captured === true;
}
