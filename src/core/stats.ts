// 능력치 수정자(PRD §4.1). 업그레이드·버프·디버프가 모두 이 형태: 최종 = (기본 + add 합) × (1 + mul 합), 한계값으로 자름.
// mul을 곱하지 않고 더하는 이유: 같은 업그레이드를 겹쳐도 지수적으로 커지지 않게(밸런스 예측 가능).

export interface StatMod {
  stat: string;
  op: 'add' | 'mul';
  value: number;
}

export type StatLimits = Readonly<Record<string, readonly number[]>>;

export function modValue(base: number, stat: string, mods: readonly StatMod[], limits?: StatLimits): number {
  let add = 0;
  let mul = 0;
  for (const m of mods) {
    if (m.stat !== stat) continue;
    if (m.op === 'add') add += m.value;
    else mul += m.value;
  }
  let v = (base + add) * (1 + mul);
  const lim = limits?.[stat];
  if (lim) v = Math.min(lim[1] ?? Infinity, Math.max(lim[0] ?? -Infinity, v));
  return v;
}

export function applyMods<T extends Readonly<Record<string, number>>>(base: T, mods: readonly StatMod[], limits?: StatLimits): T {
  const out: Record<string, number> = { ...base };
  for (const key of Object.keys(base)) out[key] = modValue(base[key] ?? 0, key, mods, limits);
  return out as T;
}
