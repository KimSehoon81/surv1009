// 전략카드 규칙(PRD §5.1·§5.3·§5.4(c), v0.2). Phaser 없음.
// 상태는 불변 데이터, 전이는 cardStep(state, action, env, rng, data) → { state, events } 순수 함수.
// UI·연출은 events만 받아 그린다(규칙과 연출이 섞이지 않게). 시간은 env.nowMs(전투 시계).

import { chanceBreakdown, pityChance, type ChanceResult, type ChanceRules } from './cardChance';
import { matchCombo, type ComboDef } from './combos';
import type { Rng } from './rng';

export interface CardDef {
  name: string;
  tag: string;
  grade: string;
  effect: string;
  params: Readonly<Record<string, number | string>>;
}

export interface CardRules extends ChanceRules {
  /** 후반(fromLevel 이상) 혼입 확률 배율 + 혼탁 카드 */
  minusLate?: { fromLevel: number; mult: number };
  initialHand: number;
  maxSelect: number;
  drawIntervalMs: number;
  submitCooldownMs: number;
  opPerFail: number;
  /** 인장에 필요한 기본 OP(인게임 작전 숙련이 env.opForSeal로 줄임) */
  opForSeal: number;
  maxSeals: number;
  minusLifeMs: number;
  minusDiscardOp: number;
  minusChance: { stage1: number; stage10: number };
  /** 뒷면 카드를 걸고 내면 +%p(뒤집힌 카드 방해 × 카드 상호작용, G9) */
  faceDownBonus?: number;
  gradeOrder: readonly string[];
  pity: boolean;
}

export interface CardData {
  cards: Readonly<Record<string, CardDef>>;
  combos: readonly ComboDef[];
  rules: CardRules;
}

export interface CardInstance {
  uid: number;
  id: string;
  /** 손패에 들어온 시각(전투 시계): 소멸 동률 처리·마이너스 자동 발동 */
  drawnAtMs: number;
  /** 혼탁 카드: 정체를 숨김(Lv7 이후 섞여 든 마이너스, PRD §5.4 a). 고르려 하거나 척후 보고·제출로 공개 */
  disguised: boolean;
  /** 혼탁 카드가 흐린 모습으로 흉내 내는 일반 카드 ID(표시용) */
  disguiseAs?: string;
  /** 뒤집힌 카드(방해 a, PRD §5.4): 뒷면이라 정체를 모름. 제출하면 공개 */
  faceDown?: boolean;
}

export interface CardStats {
  submits: number;
  successes: number;
  fails: number;
  longestFailStreak: number;
  sealsUsed: number;
}

export interface CardState {
  drawPile: string[];
  discard: string[];
  hand: CardInstance[];
  drawTimerMs: number;
  op: number;
  seals: number;
  cooldownUntilMs: number;
  failStreak: number;
  nextUid: number;
  /** 척후 보고(P10): 다음 제출에 정보 보너스(정보 카드와 중복 없음) */
  intelPrimed: boolean;
  /** 오보(M01) 등: 남은 제출 횟수 동안 성공률 감점 */
  penalties: { value: number; submits: number }[];
  comboCooldowns: Record<string, number>;
  stats: CardStats;
}

/** 매 호출마다 바뀌는 바깥 값(플레이어 능력치·방해·시각) */
export interface CardEnv {
  nowMs: number;
  handSize: number;
  drawSpeed: number;
  luck: number;
  /** 업그레이드·메타 작전 숙련 등 추가 %p */
  extraChance: number;
  /** 인장에 필요한 OP(인게임 작전 숙련이 줄임) */
  opForSeal: number;
  /** 드로우 때 마이너스 혼입 확률 */
  minusChance: number;
  /** 낼 수 없는 태그(통신 두절 M07 → intel) */
  blockedTags?: readonly string[];
  /** 태그별 판정 감점(방공망 → air 0.15) */
  tagPenalty?: Readonly<Record<string, number>>;
  /** 섞여 드는 마이너스를 혼탁 카드로(Lv7 이후) */
  disguiseMinus?: boolean;
}

export type CardAction =
  | { type: 'tick'; dtMs: number }
  /** forceSuccess: 연습 카드(첫 플레이 가이드) 확정 성공. 인장과 같은 경로지만 인장을 쓰지 않음 */
  | { type: 'submit'; uids: readonly number[]; useSeal?: boolean; forceSuccess?: boolean }
  /** 손패의 마이너스 카드 전부 정화(군의관 NPC) */
  | { type: 'purgeMinus' }
  /** 혼탁 카드 공개(uids 없으면 손패 전부): 고르려 할 때·척후 보고 */
  | { type: 'reveal'; uids?: readonly number[] }
  /** 손패 리롤(소년 통신병): 마이너스가 아닌 카드를 버리고 같은 수만큼 새로(마이너스 혼입 없음) */
  | { type: 'rerollHand' }
  /** 뒤집힌 카드 방해: 앞면인 손패 중 count장을 뒷면으로 / 방해가 끝나면 모두 앞면으로 */
  | { type: 'flipHand'; count: number }
  | { type: 'unflip' }
  | { type: 'add'; id: string; disguised?: boolean }
  | { type: 'shuffleHand' }
  | { type: 'primeIntel' }
  | { type: 'penalty'; value: number; submits: number }
  /** OP 지급(정보 카드 실패 잔효 등). 인장 변환 규칙 동일 */
  | { type: 'grantOp'; amount: number }
  /** 가장 먼저 걸린 성공률 감소 하나 해제(통신 복구) */
  | { type: 'clearPenalty' }
  /** 즉시 1장 드로우, 손패가 가득이면 OP +1(콤보 보급 G4) */
  | { type: 'drawNow' };

export type RejectReason = 'cooldown' | 'empty' | 'tooMany' | 'notInHand' | 'blockedTag' | 'noSeal' | 'notEnoughOp';

export type CardEvent =
  | { type: 'drawn'; card: CardInstance }
  | { type: 'reshuffled' }
  | { type: 'rejected'; reason: RejectReason }
  | { type: 'minusTriggered'; card: CardInstance; mult: number }
  | { type: 'minusDiscarded'; card: CardInstance }
  | { type: 'revealed'; cards: CardInstance[] }
  | { type: 'judged'; success: boolean; chance: ChanceResult; actual: number; seal: boolean; combo: string | null; cards: CardInstance[] }
  | { type: 'comboSkill'; combo: string; cards: CardInstance[] }
  | { type: 'cardEffect'; card: CardInstance }
  | { type: 'consumed'; cards: CardInstance[] }
  | { type: 'lost'; card: CardInstance }
  | { type: 'returned'; cards: CardInstance[] }
  | { type: 'purified'; card: CardInstance }
  | { type: 'opGained'; op: number }
  | { type: 'sealGained'; seals: number }
  | { type: 'sealUsed'; seals: number }
  | { type: 'handShuffled' };

export interface StepResult {
  state: CardState;
  events: CardEvent[];
}

const MINUS = 'minus';

export function isMinus(id: string, data: CardData): boolean {
  return data.cards[id]?.tag === MINUS;
}

/** 스테이지 ID(S1~S10) → 번호(혼입 곡선용, 모르면 1) */
export function stageNumber(id: string): number {
  const n = Number.parseInt(id.replace(/^S/, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 지금 혼입 확률과 혼탁 여부: 스테이지 곡선 × 후반(Lv7~) 배율(PRD §3 Lv7~9 혼입 증가, §5.4 a 혼탁 카드) */
export function minusMixAt(stage: number, level: number, rules: CardRules): { chance: number; disguise: boolean } {
  const late = rules.minusLate && level >= rules.minusLate.fromLevel;
  return { chance: Math.min(1, minusChanceFor(stage, rules) * (late ? rules.minusLate?.mult ?? 1 : 1)), disguise: Boolean(late) };
}

/** 스테이지별 마이너스 혼입 확률(스테이지 1 → 10 선형, PRD §5.4(c)) */
export function minusChanceFor(stage: number, rules: CardRules): number {
  const t = Math.min(1, Math.max(0, (stage - 1) / 9));
  return rules.minusChance.stage1 + (rules.minusChance.stage10 - rules.minusChance.stage1) * t;
}

function clone(s: CardState): CardState {
  return {
    ...s,
    drawPile: [...s.drawPile],
    discard: [...s.discard],
    hand: s.hand.map((c) => ({ ...c })),
    penalties: s.penalties.map((p) => ({ ...p })),
    comboCooldowns: { ...s.comboCooldowns },
    stats: { ...s.stats },
  };
}

function shuffle<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
  }
}

/** 손패에 넣기: 마이너스 카드는 늘 맨 오른쪽 칸(PRD §5.4(c) v0.2) */
/** 겉으로 마이너스로 보이는 카드(혼탁 카드는 일반 카드처럼 취급해 자리로 정체가 드러나지 않게) */
const shownMinus = (c: CardInstance, data: CardData) => isMinus(c.id, data) && !c.disguised;

function insertHand(s: CardState, card: CardInstance, data: CardData): void {
  if (shownMinus(card, data)) {
    s.hand.push(card);
    return;
  }
  const firstMinus = s.hand.findIndex((c) => shownMinus(c, data));
  if (firstMinus < 0) s.hand.push(card);
  else s.hand.splice(firstMinus, 0, card);
}

/** 새 판: 덱을 섞고 시작 손패를 돌린다(시작 손패에는 마이너스가 섞이지 않음) */
export function createCardState(deck: readonly string[], data: CardData, env: CardEnv, rng: Rng): StepResult {
  const s: CardState = {
    drawPile: [...deck],
    discard: [],
    hand: [],
    drawTimerMs: 0,
    op: 0,
    seals: 0,
    cooldownUntilMs: -Infinity,
    failStreak: 0,
    nextUid: 1,
    intelPrimed: false,
    penalties: [],
    comboCooldowns: {},
    stats: { submits: 0, successes: 0, fails: 0, longestFailStreak: 0, sealsUsed: 0 },
  };
  shuffle(s.drawPile, rng);
  const events: CardEvent[] = [];
  const n = Math.min(data.rules.initialHand, env.handSize);
  for (let i = 0; i < n; i++) drawOne(s, data, env, rng, events, false);
  return { state: s, events };
}

function drawOne(s: CardState, data: CardData, env: CardEnv, rng: Rng, events: CardEvent[], allowMinus: boolean): boolean {
  let id: string | undefined;
  if (allowMinus && env.minusChance > 0 && rng.next() < env.minusChance) {
    const minus = Object.keys(data.cards).filter((k) => isMinus(k, data));
    id = minus[Math.floor(rng.next() * minus.length)];
  } else {
    if (s.drawPile.length === 0 && s.discard.length > 0) {
      s.drawPile = s.discard;
      s.discard = [];
      shuffle(s.drawPile, rng);
      events.push({ type: 'reshuffled' });
    }
    id = s.drawPile.pop();
  }
  if (!id) return false;
  const card: CardInstance = { uid: s.nextUid++, id, drawnAtMs: env.nowMs, disguised: false };
  if (env.disguiseMinus && isMinus(id, data)) {
    // 혼탁 카드: 일반 카드 하나를 흐리게 흉내 냄
    const normal = Object.keys(data.cards).filter((k) => !isMinus(k, data));
    card.disguised = true;
    card.disguiseAs = normal[Math.floor(rng.next() * normal.length)];
  }
  insertHand(s, card, data);
  events.push({ type: 'drawn', card });
  return true;
}

export function cardStep(state: CardState, action: CardAction, env: CardEnv, rng: Rng, data: CardData): StepResult {
  const s = clone(state);
  const events: CardEvent[] = [];
  switch (action.type) {
    case 'tick':
      tick(s, action.dtMs, env, rng, data, events);
      break;
    case 'submit':
      submit(s, action.uids, action.useSeal ?? false, env, rng, data, events, action.forceSuccess ?? false);
      break;
    case 'add': {
      if (!data.cards[action.id]) break;
      const card: CardInstance = { uid: s.nextUid++, id: action.id, drawnAtMs: env.nowMs, disguised: action.disguised ?? false };
      if (s.hand.length < env.handSize) {
        insertHand(s, card, data);
        events.push({ type: 'drawn', card });
      } else {
        // 손패가 가득이면 다음에 뽑히도록 더미 맨 위에
        s.drawPile.push(action.id);
      }
      break;
    }
    case 'reveal': {
      const want = action.uids ? new Set(action.uids) : null;
      const hit = s.hand.filter((c) => c.disguised && (!want || want.has(c.uid)));
      if (hit.length === 0) break;
      const shown = hit.map((c) => ({ ...c, disguised: false, disguiseAs: undefined }));
      // 정체가 드러난 마이너스는 규칙대로 맨 오른쪽 칸으로
      s.hand = [...s.hand.filter((c) => !hit.includes(c)), ...shown];
      events.push({ type: 'revealed', cards: shown });
      break;
    }
    case 'rerollHand': {
      const keep = s.hand.filter((c) => isMinus(c.id, data));
      const out = s.hand.filter((c) => !isMinus(c.id, data));
      s.discard.push(...out.map((c) => c.id));
      s.hand = keep;
      for (let i = 0; i < out.length; i++) drawOne(s, data, env, rng, events, false);
      events.push({ type: 'handShuffled' });
      break;
    }
    case 'shuffleHand': {
      const real = s.hand.filter((c) => !shownMinus(c, data));
      const minus = s.hand.filter((c) => shownMinus(c, data));
      shuffle(real, rng);
      s.hand = [...real, ...minus];
      events.push({ type: 'handShuffled' });
      break;
    }
    case 'primeIntel':
      s.intelPrimed = true;
      break;
    case 'penalty':
      s.penalties.push({ value: action.value, submits: action.submits });
      break;
    case 'flipHand': {
      const up = s.hand.filter((c) => !c.faceDown);
      for (let k = 0; k < action.count && up.length > 0; k++) {
        const i = Math.floor(rng.next() * up.length);
        const c = up.splice(i, 1)[0] as CardInstance;
        s.hand = s.hand.map((h) => (h.uid === c.uid ? { ...h, faceDown: true } : h));
      }
      break;
    }
    case 'unflip':
      s.hand = s.hand.map((h) => (h.faceDown ? { ...h, faceDown: false } : h));
      break;
    case 'purgeMinus': {
      const minus = s.hand.filter((c) => data.cards[c.id]?.tag === 'minus');
      removeFromHand(s, minus);
      for (const c of minus) events.push({ type: 'purified', card: c });
      break;
    }
    case 'grantOp':
      addOp(s, action.amount, env, data, events);
      break;
    case 'clearPenalty':
      s.penalties.shift();
      break;
    case 'drawNow':
      if (s.hand.length < env.handSize) drawOne(s, data, env, rng, events, true);
      else addOp(s, 1, env, data, events);
      break;
  }
  return { state: s, events };
}

function tick(s: CardState, dtMs: number, env: CardEnv, rng: Rng, data: CardData, events: CardEvent[]): void {
  if (dtMs <= 0) return;
  // 마이너스 자동 발동(12초)
  for (let i = s.hand.length - 1; i >= 0; i--) {
    const c = s.hand[i] as CardInstance;
    if (isMinus(c.id, data) && env.nowMs - c.drawnAtMs >= data.rules.minusLifeMs) {
      s.hand.splice(i, 1);
      events.push({ type: 'minusTriggered', card: c, mult: 1 });
    }
  }
  // 드로우: 손패가 가득 찬 동안은 타이머가 쌓이지 않는다
  if (s.hand.length >= env.handSize) return;
  s.drawTimerMs += dtMs * env.drawSpeed;
  while (s.drawTimerMs >= data.rules.drawIntervalMs && s.hand.length < env.handSize) {
    s.drawTimerMs -= data.rules.drawIntervalMs;
    if (!drawOne(s, data, env, rng, events, true)) break;
  }
  if (s.hand.length >= env.handSize) s.drawTimerMs = 0;
}

interface Validated {
  cards: CardInstance[];
  real: CardInstance[];
  minus: CardInstance[];
}

function validate(s: CardState, uids: readonly number[], useSeal: boolean, env: CardEnv, data: CardData): Validated | RejectReason {
  if (uids.length === 0) return 'empty';
  if (uids.length > data.rules.maxSelect) return 'tooMany';
  const cards: CardInstance[] = [];
  for (const uid of uids) {
    const c = s.hand.find((h) => h.uid === uid);
    if (!c || cards.includes(c)) return 'notInHand';
    cards.push(c);
  }
  const real = cards.filter((c) => !isMinus(c.id, data));
  const minus = cards.filter((c) => isMinus(c.id, data));
  if (real.length === 0) {
    // 마이너스만 단독 제출 = 판정 없이 OP로 폐기
    if (s.op < data.rules.minusDiscardOp * minus.length) return 'notEnoughOp';
    return { cards, real, minus };
  }
  if (env.nowMs < s.cooldownUntilMs) return 'cooldown';
  if (useSeal && s.seals <= 0) return 'noSeal';
  if (env.blockedTags && real.some((c) => env.blockedTags?.includes(data.cards[c.id]?.tag ?? ''))) return 'blockedTag';
  return { cards, real, minus };
}

function chanceFor(s: CardState, v: Validated, useSeal: boolean, env: CardEnv, data: CardData): ChanceResult {
  const tags = new Set(v.real.map((c) => data.cards[c.id]?.tag ?? ''));
  let envPenalty = 0;
  for (const t of tags) envPenalty += env.tagPenalty?.[t] ?? 0;
  return chanceBreakdown(
    {
      realCount: v.real.length,
      hasIntel: tags.has('intel'),
      intelPrimed: s.intelPrimed,
      gamble: v.minus.length > 0,
      luck: env.luck,
      extra: env.extraChance,
      penalty: s.penalties.reduce((sum, p) => sum + p.value, 0),
      envPenalty,
      seal: useSeal,
      // 뒷면 카드를 걸고 내면 +%p(G9 S4 상호작용, 실제 카드 기준)
      extraFaceDown: v.real.some((c) => c.faceDown) ? (data.rules.faceDownBonus ?? 0) : 0,
    },
    data.rules,
  );
}

/** 실패 때 소멸할 카드: 가장 낮은 등급, 같으면 ① 레시피에 기여하지 않는 카드 ② 손패에 가장 오래 있던 카드 */
export function lossCandidate(real: readonly CardInstance[], data: CardData, cooldowns: Readonly<Record<string, number>>, nowMs: number): CardInstance | null {
  if (real.length === 0) return null;
  const rank = (c: CardInstance) => data.rules.gradeOrder.indexOf(data.cards[c.id]?.grade ?? '');
  const low = Math.min(...real.map(rank));
  const tied = real.filter((c) => rank(c) === low);
  const used = matchCombo(tagged(real, data), data.combos, cooldowns, nowMs)?.used ?? [];
  const sorted = [...tied].sort((a, b) => {
    const ua = used.includes(a.uid) ? 1 : 0;
    const ub = used.includes(b.uid) ? 1 : 0;
    return ua - ub || a.drawnAtMs - b.drawnAtMs || a.uid - b.uid;
  });
  return sorted[0] ?? null;
}

function tagged(cards: readonly CardInstance[], data: CardData) {
  return cards.map((c) => ({ uid: c.uid, tag: data.cards[c.id]?.tag ?? '' }));
}

/** OP 적립: 인장이 가득(maxSeals)이면 쌓이지 않음, 필요 OP에 닿으면 인장으로 바꿈 */
function addOp(s: CardState, amount: number, env: CardEnv, data: CardData, events: CardEvent[]): void {
  for (let i = 0; i < amount; i++) {
    if (s.seals >= data.rules.maxSeals) return;
    s.op += 1;
    events.push({ type: 'opGained', op: s.op });
    if (s.op >= env.opForSeal) {
      s.op -= env.opForSeal;
      s.seals++;
      events.push({ type: 'sealGained', seals: s.seals });
    }
  }
}

function removeFromHand(s: CardState, cards: readonly CardInstance[]): void {
  const ids = new Set(cards.map((c) => c.uid));
  s.hand = s.hand.filter((c) => !ids.has(c.uid));
}

function submit(s: CardState, uids: readonly number[], useSeal: boolean, env: CardEnv, rng: Rng, data: CardData, events: CardEvent[], force = false): void {
  const v = validate(s, uids, useSeal, env, data);
  if (typeof v === 'string') {
    events.push({ type: 'rejected', reason: v });
    return;
  }
  const r = data.rules;
  if (v.real.length === 0) {
    s.op -= r.minusDiscardOp * v.minus.length;
    removeFromHand(s, v.minus);
    for (const c of v.minus) events.push({ type: 'minusDiscarded', card: c });
    return;
  }

  const chance = chanceFor(s, v, useSeal, env, data);
  const actual = useSeal || force ? 1 : r.pity ? pityChance(chance.final, s.failStreak) : chance.final;
  const success = useSeal || force || rng.next() < actual;
  const match = matchCombo(tagged(v.real, data), data.combos, s.comboCooldowns, env.nowMs);

  s.stats.submits++;
  s.intelPrimed = false;
  s.penalties = s.penalties.map((p) => ({ ...p, submits: p.submits - 1 })).filter((p) => p.submits > 0);
  s.cooldownUntilMs = env.nowMs + r.submitCooldownMs;
  const hidden = v.cards.filter((c) => c.disguised || c.faceDown);
  if (hidden.length > 0) events.push({ type: 'revealed', cards: hidden.map((c) => ({ ...c, disguised: false, faceDown: false })) });
  events.push({ type: 'judged', success, chance, actual, seal: useSeal, combo: success && match ? match.combo.id : null, cards: v.cards });

  if (success) {
    removeFromHand(s, v.cards);
    if (match) {
      const usedCards = v.real.filter((c) => match.used.includes(c.uid));
      events.push({ type: 'comboSkill', combo: match.combo.id, cards: usedCards });
      if (match.combo.cooldownMs) s.comboCooldowns[match.combo.id] = env.nowMs + match.combo.cooldownMs;
      // 레시피에 쓰이지 않은 카드는 자기 단일 효과 후 소모(PRD §5.1 v0.2)
      for (const c of v.real) if (!match.used.includes(c.uid)) events.push({ type: 'cardEffect', card: c });
    } else {
      for (const c of v.real) events.push({ type: 'cardEffect', card: c });
    }
    s.discard.push(...v.real.map((c) => c.id));
    events.push({ type: 'consumed', cards: v.real });
    for (const c of v.minus) events.push({ type: 'purified', card: c });
    s.failStreak = 0;
    s.stats.successes++;
    if (useSeal) {
      s.seals--;
      s.stats.sealsUsed++;
      events.push({ type: 'sealUsed', seals: s.seals });
    }
    return;
  }

  // 실패: 한 장 소멸(버린 더미로), 나머지는 손패로, 무리수의 마이너스는 즉시 2배 발동
  const lost = lossCandidate(v.real, data, s.comboCooldowns, env.nowMs);
  if (lost) {
    removeFromHand(s, [lost]);
    s.discard.push(lost.id);
    events.push({ type: 'lost', card: lost });
  }
  const back = v.real.filter((c) => c !== lost);
  if (back.length > 0) events.push({ type: 'returned', cards: back });
  removeFromHand(s, v.minus);
  for (const c of v.minus) events.push({ type: 'minusTriggered', card: c, mult: 2 });
  addOp(s, r.opPerFail, env, data, events);
  s.failStreak++;
  s.stats.fails++;
  s.stats.longestFailStreak = Math.max(s.stats.longestFailStreak, s.failStreak);
}

export interface SubmitPreview {
  ok: boolean;
  reason?: RejectReason;
  chance?: ChanceResult;
  /** 성공하면 나갈 조합 */
  combo?: string;
  /** 실패하면 사라질 카드 */
  lose?: number;
  /** 마이너스만 골라 OP로 폐기하는 경우 */
  discardOnly?: boolean;
}

/** UI용 미리보기(난수 없음): 고른 카드로 내면 몇 %인지, 어떤 조합인지, 실패 시 어떤 카드가 사라지는지 */
export function previewSubmit(s: CardState, uids: readonly number[], useSeal: boolean, env: CardEnv, data: CardData): SubmitPreview {
  const v = validate(s, uids, useSeal, env, data);
  if (typeof v === 'string') return { ok: false, reason: v };
  if (v.real.length === 0) return { ok: true, discardOnly: true };
  const match = matchCombo(tagged(v.real, data), data.combos, s.comboCooldowns, env.nowMs);
  return {
    ok: true,
    chance: chanceFor(s, v, useSeal, env, data),
    combo: match?.combo.id,
    lose: lossCandidate(v.real, data, s.comboCooldowns, env.nowMs)?.uid,
  };
}
