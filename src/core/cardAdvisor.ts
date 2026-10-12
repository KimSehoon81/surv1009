// 추천 조합(PRD §3 v0.2: 아무것도 안 고른 상태의 첫 Space = 추천 채우기). Phaser 없음.
// 손패에서 1~3장 부분집합을 모두 따져 "성공률 × 가치"가 가장 큰 제출을 고른다. 마이너스 카드는 추천에 넣지 않는다.

import { previewSubmit, isMinus, type CardData, type CardEnv, type CardState } from './cards';

export interface Advice {
  uids: number[];
  combo: string | null;
  /** 표시 성공률 */
  chance: number;
  /** 실패하면 사라질 카드 */
  lose: number | null;
  score: number;
}

/** 조합은 레시피 장수만큼 크게, 단일 효과는 약하게(PRD §5.3: 단일·임의는 "약하게 발동") */
function value(combo: string | null, data: CardData, realCount: number): number {
  if (!combo) return 0.5 * realCount;
  const c = data.combos.find((x) => x.id === combo);
  return 1 + (c?.tags.length ?? 2) + (c?.priority ?? 0) * 0.05;
}

export function recommend(state: CardState, env: CardEnv, data: CardData): Advice | null {
  const hand = state.hand.filter((c) => !isMinus(c.id, data));
  let best: Advice | null = null;
  const n = hand.length;
  const consider = (idx: number[]) => {
    const uids = idx.map((i) => (hand[i] as { uid: number }).uid);
    // 쿨다운은 추천 자체와 무관하게 보이도록 시각을 쿨다운 끝으로 맞춰 미리 본다
    const pv = previewSubmit(state, uids, false, { ...env, nowMs: Math.max(env.nowMs, state.cooldownUntilMs) }, data);
    if (!pv.ok || !pv.chance) return;
    const combo = pv.combo ?? null;
    const score = pv.chance.final * value(combo, data, uids.length);
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && uids.length > best.uids.length)) {
      best = { uids, combo, chance: pv.chance.final, lose: pv.lose ?? null, score };
    }
  };
  for (let a = 0; a < n; a++) {
    consider([a]);
    for (let b = a + 1; b < n; b++) {
      consider([a, b]);
      for (let c = b + 1; c < n; c++) consider([a, b, c]);
    }
  }
  return best;
}
