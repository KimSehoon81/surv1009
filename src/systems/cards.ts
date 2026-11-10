import cardsData from '../data/cards.json';
import combosData from '../data/combos.json';
import rulesData from '../data/cardRules.json';
import cardUi from '../data/cardUi.json';
import { recommend, type Advice } from '../core/cardAdvisor';
import {
  type CardAction,
  cardStep,
  createCardState,
  minusMixAt,
  previewSubmit,
  type CardData,
  type CardEnv,
  type CardEvent,
  type CardInstance,
  type CardRules,
  type CardState,
  type SubmitPreview,
} from '../core/cards';
import type { ComboDef } from '../core/combos';
import type { Rng } from '../core/rng';
import type { GameClock } from './clock';
import type { AudioSink } from './audio';

export const CARD_DATA: CardData = {
  cards: cardsData.cards as unknown as CardData['cards'],
  combos: combosData.combos as ComboDef[],
  rules: rulesData as unknown as CardRules,
};

const FLIP_TOTAL_MS = cardUi.flipMs.out + cardUi.flipMs.back + cardUi.flipMs.hold + cardUi.flipMs.reveal;

export type JudgedEvent = Extract<CardEvent, { type: 'judged' }>;

/** 진행 중인 판정(실시간). HUD가 뒤집기를 그리고, 끝나면 결과 이벤트를 효과로 보낸다 */
export interface Judging {
  startReal: number;
  judged: JudgedEvent;
  events: CardEvent[];
  resolved: boolean;
}

/** 카드 시스템이 바깥에서 읽는 것(플레이어 능력치·스테이지·시각) */
export interface CardHost {
  readonly clock: GameClock;
  readonly audio: AudioSink;
  stats(): { handSize: number; drawSpeed: number; luck: number; blockIntel: number };
  stage(): number;
  /** 지금 레벨(후반 혼입 증가·혼탁 카드) */
  level?(): number;
  /** 인장 필요 OP 감소(인게임 작전 숙련, D09) */
  sealOpReduction(): number;
  /** 카드 입력을 받을 수 있는지(레벨업·일시정지·전사 중이 아님) */
  canAct(): boolean;
  /** 환경 보정: 태그별 판정 감점(적 방공망 공군 −15%p 등, 같은 태그는 중첩 없음) */
  tagPenalty?(): Readonly<Record<string, number>>;
  /** 캐릭터 보정(태그별 +%p) */
  tagBonus?(): Readonly<Record<string, number>>;
  /** 드로우 속도 배율(보급선 차단 −50% 등) */
  drawMul?(): number;
  /** 방해가 막는 태그(악천후 → 공군 제출 불가) */
  blockedTags?(): readonly string[];
  /** 판정 결과 연출(금색 플래시 등) */
  onResult(success: boolean): void;
  /** 카드 효과·조합 스킬·마이너스 발동·실패 소멸(잔효) */
  onEffect(ev: CardEvent): void;
}

/**
 * 전투 중 카드: core/cards 상태를 들고 시간·입력을 넣는다. 규칙은 core, 그리기는 HUD.
 * 제출 즉시 판정(상태 확정) → 0.6초 뒤집기(실시간) 동안 결과를 숨겼다가 끝나면 소리·효과를 낸다.
 */
export class CardSystem {
  state: CardState;
  /** 고른 카드 uid(고른 순서) */
  selected: number[] = [];
  /** 편의 옵션(설정): 선택 슬로모, 판정 연출 시간 배율(짧게 0.5), 마이너스 자동 폐기 */
  selectSlowmo = true;
  judgeMul = 1;
  autoDiscardMinus = false;
  judging: Judging | null = null;
  /** 마지막 거부 사유와 시각(HUD 안내용) */
  lastReject: { reason: string; atReal: number } | null = null;
  private selectStartReal: number | null = null;
  private selectExpired = false;
  /** 연습 카드 uid(첫 플레이 가이드): 이 카드가 들어간 첫 제출은 확정 성공 */
  readonly practice = new Set<number>();
  /** 연출용 이벤트 목록(HUD가 매 프레임 가져가 비움) */
  readonly feed: CardEvent[] = [];

  constructor(
    private readonly host: CardHost,
    private readonly rng: Rng,
    deck: readonly string[] = cardsData.starterDeck,
  ) {
    const r = createCardState(deck, CARD_DATA, this.env(), rng);
    this.state = r.state;
    this.feed.push(...r.events);
  }

  env(): CardEnv {
    const s = this.host.stats();
    const mix = minusMixAt(this.host.stage(), this.host.level?.() ?? 1, CARD_DATA.rules);
    return {
      nowMs: this.host.clock.timeMs,
      handSize: Math.round(s.handSize),
      drawSpeed: s.drawSpeed * (this.host.drawMul?.() ?? 1),
      luck: s.luck,
      extraChance: 0,
      opForSeal: CARD_DATA.rules.opForSeal - this.host.sealOpReduction(),
      minusChance: mix.chance,
      disguiseMinus: mix.disguise,
      blockedTags: [...(s.blockIntel > 0 ? ['intel'] : []), ...(this.host.blockedTags?.() ?? [])],
      tagPenalty: this.host.tagPenalty?.(),
      tagBonus: this.host.tagBonus?.(),
    };
  }

  get opForSeal(): number {
    return CARD_DATA.rules.opForSeal - this.host.sealOpReduction();
  }

  /** 지금 고른 카드로 내면(미리보기) */
  preview(useSeal = false): SubmitPreview | null {
    if (this.selected.length === 0) return null;
    const pv = previewSubmit(this.state, this.selected, useSeal, this.env(), CARD_DATA);
    // 연습 카드가 들어가면 확정 성공으로 보여 준다
    if (pv.chance && this.selected.some((uid) => this.practice.has(uid))) return { ...pv, chance: { ...pv.chance, final: 1 }, lose: undefined };
    return pv;
  }

  private adviceCache: { sig: string; advice: Advice | null } | null = null;

  /** 추천 조합. 손패·인장·보너스가 그대로면 지난 계산을 다시 쓴다(HUD·가이드가 매 프레임 부름) */
  advice(): Advice | null {
    const st = this.state;
    const sig = `${st.hand.map((c) => c.uid).join(',')}|${st.seals}|${st.intelPrimed}|${st.penalties.length}|${this.practice.size}|${this.host.stats().blockIntel}|${this.host.stats().luck}|${Object.values(st.comboCooldowns).filter((t) => t > this.host.clock.timeMs).length}`;
    if (this.adviceCache?.sig === sig) return this.adviceCache.advice;
    const advice = this.computeAdvice();
    this.adviceCache = { sig, advice };
    return advice;
  }

  private computeAdvice(): Advice | null {
    // 연습 짝이 손에 다 있으면 그것을 추천(첫 판: Space 두 번이면 정밀 폭격 확정 성공)
    const practice = this.state.hand.filter((c) => this.practice.has(c.uid)).map((c) => c.uid);
    if (practice.length > 0 && practice.length === this.practice.size) {
      const pv = previewSubmit(this.state, practice, false, this.env(), CARD_DATA);
      if (pv.ok) return { uids: practice, combo: pv.combo ?? null, chance: 1, lose: null, score: Infinity };
    }
    return recommend(this.state, this.env(), CARD_DATA);
  }

  /** 매 프레임: 전투 시계 dt로 드로우·마이너스 타이머, 실시간으로 판정 연출 끝·선택 슬로모 */
  update(dtMs: number, nowReal: number): void {
    if (dtMs > 0) this.apply(cardStep(this.state, { type: 'tick', dtMs }, this.env(), this.rng, CARD_DATA));
    // 손에서 사라진 카드는 선택에서 뺀다(마이너스 자동 발동·섞임 등)
    this.selected = this.selected.filter((uid) => this.state.hand.some((c) => c.uid === uid));
    if (this.judging && !this.judging.resolved && nowReal - this.judging.startReal >= FLIP_TOTAL_MS * this.judgeMul) this.resolve();
    if (this.judging && nowReal - this.judging.startReal >= (FLIP_TOTAL_MS + cardUi.resultMs) * this.judgeMul) this.judging = null;
    this.updateSelectSlowmo(nowReal);
    this.autoDiscard(nowReal);
  }

  /** 손패 i번째 칸 선택/해제 */
  toggle(index: number): void {
    if (!this.host.canAct() || this.judging) return;
    const card = this.state.hand[index];
    if (!card) return;
    if (card.disguised) {
      // 혼탁 카드: 고르려는 순간 정체가 드러남(고르지는 않음 — 마이너스임을 보고 다시 판단)
      this.act({ type: 'reveal', uids: [card.uid] });
      return;
    }
    const at = this.selected.indexOf(card.uid);
    if (at >= 0) {
      this.selected.splice(at, 1);
      this.host.audio.play('card_deselect');
    } else if (this.selected.length < CARD_DATA.rules.maxSelect) {
      this.selected.push(card.uid);
      this.host.audio.play('card_select', undefined, undefined, { combo: index + 1 });
    } else {
      this.reject('tooMany');
    }
  }

  clear(): void {
    if (this.selected.length === 0) return;
    this.selected = [];
    this.host.audio.play('card_deselect');
  }

  /**
   * 작전 개시. 아무것도 안 골랐으면 추천 조합을 채우기만 한다(한 번 더 누르면 제출, PRD §3 v0.2).
   * useSeal이면 인장 걸고 제출.
   */
  submit(useSeal = false, nowReal = 0): void {
    if (!this.host.canAct()) return;
    if (this.judging) {
      this.reject('judging', nowReal);
      return;
    }
    if (this.selected.length === 0) {
      const a = this.advice();
      if (!a) {
        this.reject('empty', nowReal);
        return;
      }
      this.selected = [...a.uids];
      this.host.audio.play('card_select', undefined, undefined, { combo: 3 });
      return;
    }
    const forceSuccess = this.selected.some((uid) => this.practice.has(uid));
    const r = cardStep(this.state, { type: 'submit', uids: this.selected, useSeal, forceSuccess }, this.env(), this.rng, CARD_DATA);
    const rejected = r.events.find((e) => e.type === 'rejected');
    if (rejected) {
      this.reject(rejected.reason, nowReal);
      return;
    }
    this.apply(r);
    if (forceSuccess) this.practice.clear();
    this.selected = [];
    const judged = r.events.find((e): e is JudgedEvent => e.type === 'judged');
    if (!judged) {
      // 마이너스 단독 폐기: 판정 없음
      this.host.audio.play('card_submit');
      return;
    }
    this.host.audio.play('card_submit');
    this.host.audio.play('judge_roll');
    // 조합 판정(실제 카드 2장 이상)만 판정 슬로모(PRD §5.1 v0.2)
    const real = judged.cards.filter((c) => CARD_DATA.cards[c.id]?.tag !== 'minus').length;
    if (real >= 2 && this.judgeMul >= 1) this.host.clock.setScale('judge', cardUi.judgeSlowmo.scale, cardUi.judgeSlowmo.ms);
    this.judging = { startReal: nowReal, judged, events: r.events, resolved: false };
  }

  /** 판정 뒤집기가 끝난 순간: 결과 소리·연출과 효과 이벤트 */
  private resolve(): void {
    const j = this.judging;
    if (!j) return;
    j.resolved = true;
    const success = j.judged.success;
    this.host.audio.play(success ? 'judge_success' : 'judge_fail');
    this.host.onResult(success);
    for (const ev of j.events) {
      if (ev.type === 'comboSkill' || ev.type === 'cardEffect' || ev.type === 'minusTriggered' || ev.type === 'purified' || ev.type === 'lost') this.host.onEffect(ev);
    }
    this.opSounds(j.events);
  }

  private opSounds(events: readonly CardEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'opGained') this.host.audio.play('op_tick', undefined, undefined, { combo: ev.op });
      if (ev.type === 'sealGained') this.host.audio.play('seal_stamp');
    }
  }

  /** 카드 효과가 카드 상태를 바꿀 때(척후 보고·오보·잔효 OP·지휘 혼선·콤보 보급·통신 복구) */
  act(action: Extract<CardAction, { type: 'primeIntel' | 'penalty' | 'grantOp' | 'shuffleHand' | 'drawNow' | 'clearPenalty' | 'purgeMinus' | 'flipHand' | 'unflip' | 'reveal' | 'rerollHand' }>): CardEvent[] {
    const r = cardStep(this.state, action, this.env(), this.rng, CARD_DATA);
    this.apply(r);
    if (action.type === 'shuffleHand' || action.type === 'rerollHand') this.selected = [];
    this.opSounds(r.events);
    return r.events;
  }

  private reject(reason: string, nowReal = 0): void {
    this.lastReject = { reason, atReal: nowReal };
    this.host.audio.play('card_reject');
  }

  private apply(r: { state: CardState; events: CardEvent[] }): void {
    this.state = r.state;
    this.feed.push(...r.events);
    // 판정과 무관하게 바로 일어나는 일(마이너스 자동 발동·단독 폐기)
    for (const ev of r.events) {
      if (ev.type === 'minusTriggered' && !r.events.some((e) => e.type === 'judged')) this.host.onEffect(ev);
      if (ev.type === 'revealed') this.host.onEffect(ev);
    }
  }

  /** 마이너스 자동 폐기(편의 옵션): 고른 카드가 없고 OP가 되면 드러난 마이너스를 바로 폐기 */
  private autoDiscard(nowReal: number): void {
    if (!this.autoDiscardMinus || this.judging || this.selected.length > 0 || !this.host.canAct()) return;
    if (this.state.op < CARD_DATA.rules.minusDiscardOp) return;
    const m = this.state.hand.find((c) => !c.disguised && CARD_DATA.cards[c.id]?.tag === 'minus');
    if (!m) return;
    this.selected = [m.uid];
    this.submit(false, nowReal);
    this.selected = [];
  }

  /** 카드를 고른 동안 전투 0.6배, 한 번 고르기 시작해 2초가 지나면 풀림(편의 옵션) */
  private updateSelectSlowmo(nowReal: number): void {
    const cfg = cardUi.selectSlowmo;
    const clock = this.host.clock;
    if (!cfg.enabled || !this.selectSlowmo || this.selected.length === 0 || !this.host.canAct()) {
      clock.clearScale('select');
      if (this.selected.length === 0) {
        this.selectStartReal = null;
        this.selectExpired = false;
      }
      return;
    }
    this.selectStartReal ??= nowReal;
    if (this.selectExpired || nowReal - this.selectStartReal > cfg.maxMs) {
      this.selectExpired = true;
      clock.clearScale('select');
      return;
    }
    clock.setScale('select', cfg.scale);
  }

  /** 디버그·NPC: 카드 지급 */
  give(id: string): CardInstance | null {
    const r = cardStep(this.state, { type: 'add', id }, this.env(), this.rng, CARD_DATA);
    this.apply(r);
    const d = r.events.find((e) => e.type === 'drawn');
    return d && d.type === 'drawn' ? d.card : null;
  }

  /** 첫 판 첫 손패에 연습 카드(공군+정보 짝)를 넣는다 */
  seedPractice(ids: readonly string[]): void {
    for (const id of ids) {
      const c = this.give(id);
      if (c) this.practice.add(c.uid);
    }
  }
}
