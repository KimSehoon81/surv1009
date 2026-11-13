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
  // 기본값에서부터 함께 쓰던 키(레벨업 R과 스킬 R처럼 상황이 겹치지 않는 것)는 허용, 그 밖에 같은 묶음에서 겹치면 거부
  const ownDefault = (defaults[action] ?? []).includes(k);
  for (const other of group) {
    if (other === action || !(cur[other] ?? []).includes(k)) continue;
    if (ownDefault && (defaults[other] ?? []).includes(k)) continue;
    return { ok: false, conflict: other };
  }
  const rest = (cur[action] ?? []).slice(1).filter((x) => x !== k);
  return { ok: true, overrides: { ...(overrides ?? {}), [action]: [k, ...rest] } };
}

/** 같은 묶음 안에서 키가 겹치는 액션 → 겹치는 상대들(기본값부터 공유하던 키는 제외). 예전 저장·기본값 변경으로 생긴 충돌 경고용 */
export function conflicts(defaults: KeyMap, keys: KeyMap, group: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of group)
    for (const b of group) {
      if (a === b) continue;
      const shared = (keys[a] ?? []).filter((k) => (keys[b] ?? []).includes(k) && !((defaults[a] ?? []).includes(k) && (defaults[b] ?? []).includes(k)));
      if (shared.length > 0) (out[a] ??= []).push(b);
    }
  return out;
}
