// 키 재설정(PRD §11): 액션 → 키 목록. 기본값(controls.json) 위에 덮어쓰기만 저장. Phaser 없음(테스트 대상).

export type KeyMap = Readonly<Record<string, readonly string[]>>;

/** 실제로 쓸 키: 덮어쓴 액션은 그 목록, 나머지는 기본값 */
export function effectiveKeys(defaults: KeyMap, overrides: KeyMap | undefined): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = { ...defaults };
  for (const [a, keys] of Object.entries(overrides ?? {})) if (a in defaults && keys.length > 0) out[a] = keys;
  return out;
}

export type RebindResult = { ok: true; overrides: Record<string, readonly string[]> } | { ok: false; conflict: string };

/**
 * action의 첫 키를 key로 바꾼다(나머지 대체 키는 유지, 같은 키는 빼고). 같은 전투 묶음(group)의 다른 액션이 이미 그 키를 쓰면 거부.
 * 키 이름은 대문자 Phaser 키 이름(Q, SPACE, ONE …)
 */
export function rebind(defaults: KeyMap, overrides: KeyMap | undefined, action: string, key: string, group: readonly string[]): RebindResult {
  const k = key.toUpperCase();
  const cur = effectiveKeys(defaults, overrides);
  // 그 액션의 기본 키로 되돌리는 것은 늘 허용(기본 공유 키 포함)
  const ownDefault = (defaults[action] ?? []).includes(k);
  for (const other of ownDefault ? [] : group) {
    if (other === action) continue;
    if ((cur[other] ?? []).includes(k)) return { ok: false, conflict: other };
  }
  const rest = (cur[action] ?? []).slice(1).filter((x) => x !== k);
  return { ok: true, overrides: { ...(overrides ?? {}), [action]: [k, ...rest] } };
}
