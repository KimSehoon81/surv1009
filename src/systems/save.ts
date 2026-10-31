// 저장 인터페이스(D17 세이브 슬롯으로 이관 예정). 지금은 localStorage 키별 JSON.
// 저장소가 막힌 환경(시크릿 창·미리보기)에서도 게임이 돌게 실패하면 메모리에만 둔다.

export interface SaveStore {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

const PREFIX = 'amnok.';
const memory = new Map<string, string>();

function raw(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export const save: SaveStore = {
  get<T>(key: string, fallback: T): T {
    const v = raw(key);
    if (v === null) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    const v = JSON.stringify(value);
    try {
      localStorage.setItem(PREFIX + key, v);
    } catch {
      memory.set(key, v);
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      memory.delete(key);
    }
  },
};
