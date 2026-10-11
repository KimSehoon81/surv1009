// 조합 레시피 매칭(PRD §5.3). 제출 카드 태그 안에 들어가는 레시피 중 카드를 가장 많이 쓰는 것, 같으면 priority가 큰 것.

export interface ComboDef {
  id: string;
  name: string;
  tags: readonly string[];
  priority: number;
  cooldownMs?: number;
}

export interface TaggedCard {
  uid: number;
  tag: string;
}

export interface ComboMatch {
  combo: ComboDef;
  /** 레시피에 쓰인 카드 uid(제출 순서대로 앞에서부터 배정) */
  used: number[];
}

export function matchCombo(
  cards: readonly TaggedCard[],
  combos: readonly ComboDef[],
  cooldowns: Readonly<Record<string, number>> = {},
  nowMs = 0,
): ComboMatch | null {
  let best: ComboMatch | null = null;
  for (const combo of combos) {
    if ((cooldowns[combo.id] ?? -Infinity) > nowMs) continue;
    const free = [...cards];
    const used: number[] = [];
    let ok = true;
    for (const tag of combo.tags) {
      const i = free.findIndex((c) => c.tag === tag);
      if (i < 0) {
        ok = false;
        break;
      }
      used.push((free.splice(i, 1)[0] as TaggedCard).uid);
    }
    if (!ok) continue;
    if (
      !best ||
      combo.tags.length > best.combo.tags.length ||
      (combo.tags.length === best.combo.tags.length && combo.priority > best.combo.priority)
    ) {
      best = { combo, used };
    }
  }
  return best;
}
