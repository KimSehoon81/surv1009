// 프로필 저장소(localStorage 키 하나에 core/save 스키마 JSON). 손상되면 원본을 백업 키에 보관하고 새로 시작한다.
// 저장소가 막힌 환경(시크릿 창·미리보기)에서도 게임이 돌게 실패하면 메모리에만 둔다.

import { parseSave, serialize, type LegacyKeys, type LoadResult, type SaveData } from '../core/save';

const KEY = 'amnok.save';
const BACKUP_PREFIX = 'amnok.save.backup.';
/** D14~D16에 키마다 따로 쓰던 것(v0 마이그레이션 대상) */
const LEGACY = { guide: 'amnok.guide', firstRunDone: 'amnok.profile.firstRunDone', volume: 'amnok.settings.volume', merit: 'amnok.merit' };

const memory = new Map<string, string>();
let cached: SaveData | null = null;
let lastStatus: LoadResult['status'] = 'new';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    memory.delete(key);
  }
}

function json<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function loadProfile(): SaveData {
  if (cached) return cached;
  const text = read(KEY);
  const legacy: LegacyKeys = {
    guide: json(read(LEGACY.guide)),
    firstRunDone: json(read(LEGACY.firstRunDone)),
    volume: json(read(LEGACY.volume)),
    merit: json(read(LEGACY.merit)),
  };
  const r = parseSave(text, legacy);
  lastStatus = r.status;
  if (r.status === 'corrupt' && text !== null) {
    write(`${BACKUP_PREFIX}${Date.now()}`, text);
    console.warn('[save] save corrupted — backed up, starting fresh');
  }
  cached = r.data;
  if (r.status !== 'ok') {
    write(KEY, serialize(r.data));
    for (const k of Object.values(LEGACY)) remove(k);
  }
  return cached;
}

export function saveProfile(d: SaveData): void {
  cached = d;
  write(KEY, serialize(d));
}

/** 고쳐서 저장. fn이 새 객체를 돌려주면 그것을, 아니면 바뀐 원본을 저장 */
export function updateProfile(fn: (d: SaveData) => SaveData | void): SaveData {
  const cur = loadProfile();
  const next = fn(cur) ?? cur;
  saveProfile(next);
  return next;
}

/** 저장 초기화(?reset=1, 설정 화면) */
export function resetProfile(): void {
  remove(KEY);
  for (const k of Object.values(LEGACY)) remove(k);
  cached = null;
}

/** 마지막으로 불러온 상태(new·ok·migrated·corrupt) */
export function loadStatus(): LoadResult['status'] {
  return lastStatus;
}
