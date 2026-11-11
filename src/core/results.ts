// 런 정산(PRD §3·§8.1): 전공 포인트 식(data/meta.json)과 작전 기록, 패배 원인 팁. Phaser 없음(테스트 대상).

export interface RunRecord {
  victory: boolean;
  timeSec: number;
  level: number;
  kills: number;
  eliteKills: number;
  bossKill: boolean;
  /** 카드 작전 기록 */
  submits: number;
  successes: number;
  longestFailStreak: number;
  sealsUsed: number;
  sealsHeld: number;
  /** 실패 잔효로 준 피해 합 */
  residueDamage: number;
  comboSuccesses: number;
  /** 마지막으로 플레이어를 해친 공격 종류(contact·lob·dash·boss 등) */
  lastHitBy: string;
  /** 신병 모드(받는 피해 −30%)로 한 판 — 결과 화면에 표시(보상 불이익 없음) */
  recruit?: boolean;
  /** 출정 때 쓰지 않고 남긴 전공(스타팅 포인트로 쓸 수 있었던 양, 패배 팁) */
  unspentMerit?: number;
  /** 해금했지만 이번에 쓰지 않은 캐릭터 수(패배 팁) */
  otherChars?: number;
}

export interface MeritFormula {
  perKill: number;
  perEliteKill: number;
  perLevel: number;
  perMinute: number;
  captureBonus: number;
  bossKill: number;
  defeatRatio: number;
}

export function meritPoints(r: RunRecord, f: MeritFormula): number {
  const base =
    r.kills * f.perKill +
    r.eliteKills * f.perEliteKill +
    r.level * f.perLevel +
    (r.timeSec / 60) * f.perMinute +
    (r.victory ? f.captureBonus : 0) +
    (r.bossKill ? f.bossKill : 0);
  return Math.round(base * (r.victory ? 1 : f.defeatRatio));
}

/** 실제 성공률(표시용 정수 %) */
export function actualRate(r: RunRecord): number {
  return r.submits > 0 ? Math.round((r.successes / r.submits) * 100) : 0;
}

/** 패배 원인 팁 한 줄: 위에서부터 먼저 맞는 규칙 */
export function defeatTip(r: RunRecord, tips: Readonly<Record<string, string>>): string {
  const pick = (k: string): string => (tips[k] ?? tips.default ?? '').replace('{merit}', String(r.unspentMerit ?? 0));
  // 일찍 쓰러졌는데 출정 준비에서 쓸 수 있던 힘이 남았으면 그것부터(가장 바로 효과 있는 조언)
  if (r.timeSec < 300 && (r.unspentMerit ?? 0) >= 100) return pick('spendMerit');
  if (r.lastHitBy.startsWith('boss')) return pick('boss');
  if (r.lastHitBy === 'lob') return pick('lob');
  if (r.lastHitBy === 'dash') return pick('dash');
  if (r.level <= 3) return pick('early');
  if (r.sealsHeld > 0) return pick('seals');
  if (r.submits < 5) return pick('fewSubmits');
  return pick('default');
}
