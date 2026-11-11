// 업적·도감(D41): 게임 이벤트 하나를 받아 데이터 정의({event, where, min, max, distinct, target})로 판정하는 순수 함수. Phaser 없음(테스트 대상).

export type GameEvent = { type: string } & Readonly<Record<string, string | number | boolean | undefined>>;

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** 이 종류의 이벤트만 센다(kill·capture·cardJudged·skill·npc·noHit …) */
  event: string;
  /** 이 값과 같아야 함 */
  where?: Readonly<Record<string, string | number | boolean>>;
  /** 이 값 이상 / 이하 */
  min?: Readonly<Record<string, number>>;
  max?: Readonly<Record<string, number>>;
  /** 서로 다른 값의 수를 셈(예: enemy → 다른 보스 수) */
  distinct?: string;
  /** 이 만큼 모이면 달성 */
  target: number;
  /** 달성 보상 전공 포인트(여유) */
  reward?: number;
}

export interface AchievementState {
  done: string[];
  counters: Record<string, number>;
  /** distinct 업적이 본 값들 */
  sets: Record<string, string[]>;
}

export const emptyAchievements = (): AchievementState => ({ done: [], counters: {}, sets: {} });

function matches(d: AchievementDef, ev: GameEvent): boolean {
  if (d.event !== ev.type) return false;
  for (const [k, v] of Object.entries(d.where ?? {})) if (ev[k] !== v) return false;
  for (const [k, v] of Object.entries(d.min ?? {})) if (!(typeof ev[k] === 'number' && (ev[k] as number) >= v)) return false;
  for (const [k, v] of Object.entries(d.max ?? {})) if (!(typeof ev[k] === 'number' && (ev[k] as number) <= v)) return false;
  return true;
}

/** 이벤트 하나 반영: 새로 달성한 업적 목록(이미 달성한 것은 더 세지 않음). 원래 상태는 바꾸지 않음 */
export function applyEvent(s: AchievementState, ev: GameEvent, defs: readonly AchievementDef[]): { state: AchievementState; unlocked: AchievementDef[] } {
  let next = s;
  const unlocked: AchievementDef[] = [];
  for (const d of defs) {
    if (s.done.includes(d.id) || !matches(d, ev)) continue;
    if (next === s) next = { done: [...s.done], counters: { ...s.counters }, sets: { ...s.sets } };
    let count: number;
    if (d.distinct) {
      const v = String(ev[d.distinct] ?? '');
      const set = next.sets[d.id] ?? [];
      if (!set.includes(v)) next.sets[d.id] = [...set, v];
      count = next.sets[d.id]?.length ?? 0;
    } else {
      count = (next.counters[d.id] ?? 0) + 1;
    }
    next.counters[d.id] = count;
    if (count >= d.target) {
      next.done.push(d.id);
      unlocked.push(d);
    }
  }
  return { state: next, unlocked };
}

/** 진행도 0~1(표시용) */
export function progressOf(s: AchievementState, d: AchievementDef): number {
  if (s.done.includes(d.id)) return 1;
  return Math.min(1, (s.counters[d.id] ?? 0) / d.target);
}

export type CodexKind = 'chars' | 'enemies' | 'cards';
export type Codex = Record<CodexKind, string[]>;

export const emptyCodex = (): Codex => ({ chars: [], enemies: [], cards: [] });

/** 도감에 본 ID 더하기(이미 있으면 그대로 같은 객체) */
export function addSeen(c: Codex, kind: CodexKind, id: string): Codex {
  if (c[kind].includes(id)) return c;
  return { ...c, [kind]: [...c[kind], id] };
}
