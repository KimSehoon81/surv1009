import cardsData from '../data/cards.json';
import combosData from '../data/combos.json';
import rulesData from '../data/cardRules.json';
import cardUi from '../data/cardUi.json';
import { recommend, type Advice } from '../core/cardAdvisor';
import {
  type CardAction,
  cardStep,
  createCardState,
  minusChanceFor,
  previewSubmit,
  type CardData,
  type CardEnv,
  type CardEvent,
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
  /** 인장 필요 OP 감소(인게임 작전 숙련, D09) */
  sealOpReduction(): number;
  /** 카드 입력을 받을 수 있는지(레벨업·일시정지·전사 중이 아님) */
  canAct(): boolean;
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
  judging: Judging | null = null;
  /** 마지막 거부 사유와 시각(HUD 안내용) */
  lastReject: { reason: string; atReal: number } | null = null;
  private selectStartReal: number | null = null;
  private selectExpired = false;
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
    return {
      nowMs: this.host.clock.timeMs,
      handSize: Math.round(s.handSize),
      drawSpeed: s.drawSpeed,
      luck: s.luck,
      extraChance: 0,
      opForSeal: CARD_DATA.rules.opForSeal - this.host.sealOpReduction(),
      minusChance: minusChanceFor(this.host.stage(), CARD_DATA.rules),
      blockedTags: s.blockIntel > 0 ? ['intel'] : [],
    };
  }

  get opForSeal(): number {
    return CARD_DATA.rules.opForSeal - this.host.sealOpReduction();
  }

  /** 지금 고른 카드로 내면(미리보기) */
  preview(useSeal = false): SubmitPreview | null {
    if (this.selected.length === 0) return null;
    return previewSubmit(this.state, this.selected, useSeal, this.env(), CARD_DATA);
  }

  advice(): Advice | null {
    return recommend(this.state, this.env(), CARD_DATA);
  }

  /** 매 프레임: 전투 시계 dt로 드로우·마이너스 타이머, 실시간으로 판정 연출 끝·선택 슬로모 */
  update(dtMs: number, nowReal: number): void {
    if (dtMs > 0) this.apply(cardStep(this.state, { type: 'tick', dtMs }, this.env(), this.rng, CARD_DATA));
    // 손에서 사라진 카드는 선택에서 뺀다(마이너스 자동 발동·섞임 등)
    this.selected = this.selected.filter((uid) => this.state.hand.some((c) => c.uid === uid));
    if (this.judging && !this.judging.resolved && nowReal - this.judging.startReal >= FLIP_TOTAL_MS) this.resolve();
    if (this.judging && nowReal - this.judging.startReal >= FLIP_TOTAL_MS + cardUi.resultMs) this.judging = null;
    this.updateSelectSlowmo(nowReal);
  }

  /** 손패 i번째 칸 선택/해제 */
  toggle(index: number): void {
    if (!this.host.canAct() || this.judging) return;
    const card = this.state.hand[index];
    if (!card) return;
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
    const r = cardStep(this.state, { type: 'submit', uids: this.selected, useSeal }, this.env(), this.rng, CARD_DATA);
    const rejected = r.events.find((e) => e.type === 'rejected');
    if (rejected) {
      this.reject(rejected.reason, nowReal);
      return;
    }
    this.apply(r);
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
    if (real >= 2) this.host.clock.setScale('judge', cardUi.judgeSlowmo.scale, cardUi.judgeSlowmo.ms);
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
  act(action: Extract<CardAction, { type: 'primeIntel' | 'penalty' | 'grantOp' | 'shuffleHand' | 'drawNow' | 'clearPenalty' }>): CardEvent[] {
    const r = cardStep(this.state, action, this.env(), this.rng, CARD_DATA);
    this.apply(r);
    if (action.type === 'shuffleHand') this.selected = [];
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
    }
  }

  /** 카드를 고른 동안 전투 0.6배, 한 번 고르기 시작해 2초가 지나면 풀림(편의 옵션) */
  private updateSelectSlowmo(nowReal: number): void {
    const cfg = cardUi.selectSlowmo;
    const clock = this.host.clock;
    if (!cfg.enabled || this.selected.length === 0 || !this.host.canAct()) {
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
  give(id: string): void {
    this.apply(cardStep(this.state, { type: 'add', id }, this.env(), this.rng, CARD_DATA));
  }
}
