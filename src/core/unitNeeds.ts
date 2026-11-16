// 전투 한 판에 필요한 유닛(그림을 올릴 대상) 찾기: 스테이지·규칙 데이터 안의 id를 모으고, 그 유닛이 부르는 유닛(소환·겉모습 변형)까지 따라감. Phaser 없음

/** 데이터 어디에 있든(키·값) known에 있는 문자열을 모음 */
export function collectIds(root: unknown, known: ReadonlySet<string>, out: Set<string> = new Set()): Set<string> {
  if (typeof root === 'string') {
    if (known.has(root)) out.add(root);
  } else if (Array.isArray(root)) {
    for (const v of root) collectIds(v, known, out);
  } else if (root && typeof root === 'object') {
    for (const [k, v] of Object.entries(root)) {
      if (known.has(k)) out.add(k);
      collectIds(v, known, out);
    }
  }
  return out;
}

/** seeds에서 시작해 각 유닛 정의(defs[id])가 가리키는 유닛까지 모두(순서 = 발견 순) */
export function closeOver(seeds: Iterable<string>, defs: Readonly<Record<string, unknown>>, known: ReadonlySet<string>): string[] {
  const out = new Set<string>(seeds);
  const queue = [...out];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    for (const next of collectIds(defs[id], known)) {
      if (!out.has(next)) {
        out.add(next);
        queue.push(next);
      }
    }
  }
  return [...out];
}
