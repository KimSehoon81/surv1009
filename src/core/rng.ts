// 시드 고정 난수. 게임의 모든 확률(카드 판정, 스폰, 업그레이드 추첨)은 이 모듈만 사용한다.
// 같은 시드면 같은 결과가 나와야 테스트·리플레이·버그 재현이 가능하다.

export type Seed = number | string;

export interface RngState {
  readonly seed: number;
  readonly cursor: number;
}

export interface Rng {
  /** 생성 시 정해진 32비트 시드 (fork 파생의 기준) */
  readonly seed: number;
  /** [0, 1) 균등 분포 */
  next(): number;
  /** [min, max) 실수 */
  range(min: number, max: number): number;
  /** [min, max] 정수 (양 끝 포함) */
  int(min: number, max: number): number;
  /** 확률 p(0~1)로 true */
  chance(p: number): boolean;
  /** 배열에서 하나. 빈 배열이면 오류 */
  pick<T>(items: readonly T[]): T;
  /** 가중치 비례 추첨. 가중치 합이 0 이하면 오류 */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  /** 섞은 새 배열 (원본 불변) */
  shuffle<T>(items: readonly T[]): T[];
  /**
   * 이름으로 독립 스트림을 파생한다. 부모가 난수를 몇 번 뽑았는지와 무관하게
   * (부모 시드, 이름)만으로 결정되므로, 한 시스템에 추첨을 추가해도 다른 시스템의 결과가 바뀌지 않는다.
   */
  fork(name: string): Rng;
  /** 저장·복원용 상태 */
  getState(): RngState;
}

/** 문자열 → 32비트 해시 (FNV-1a) */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 32비트 정수 섞기 (murmur3 fmix32). 비슷한 시드끼리 결과가 비슷해지는 것을 막는다 */
function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function normalizeSeed(seed: Seed): number {
  return typeof seed === 'string' ? hashString(seed) : seed >>> 0;
}

/** mulberry32: 상태 32비트, 빠르고 게임 용도로 충분한 품질 */
function mulberry32(state: number): { value: number; state: number } {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: next };
}

export function createRng(seed: Seed): Rng {
  return fromState({ seed: normalizeSeed(seed), cursor: 0 });
}

export function fromState(saved: RngState): Rng {
  const seed = saved.seed >>> 0;
  let cursor = saved.cursor;
  // 내부 상태는 (시드 섞은 값 + cursor 스텝)으로 재구성 가능해야 저장·복원이 단순하다
  const base = mix32(seed);
  let state = (base + Math.imul(cursor, 0x6d2b79f5)) >>> 0;

  const next = (): number => {
    const r = mulberry32(state);
    state = r.state;
    cursor++;
    return r.value;
  };

  const rng: Rng = {
    seed,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance: (p) => (p <= 0 ? false : p >= 1 ? true : next() < p),
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick: 빈 배열');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items, weightOf) => {
      let total = 0;
      for (const item of items) total += Math.max(0, weightOf(item));
      if (total <= 0) throw new Error('rng.weighted: 가중치 합이 0');
      let roll = next() * total;
      for (const item of items) {
        const w = Math.max(0, weightOf(item));
        if (roll < w) return item;
        roll -= w;
      }
      // 부동소수 오차로 끝까지 온 경우: 마지막 양수 가중치 항목
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i] as (typeof items)[number];
        if (weightOf(item) > 0) return item;
      }
      throw new Error('rng.weighted: 도달 불가');
    },
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
    fork: (name) => createRng(mix32(seed ^ hashString(name))),
    getState: () => ({ seed, cursor }),
  };
  return rng;
}
