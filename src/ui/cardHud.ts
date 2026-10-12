import * as Phaser from 'phaser';
import cardUi from '../data/cardUi.json';
import cardsData from '../data/cards.json';
import { manifest } from '../assets/manifest';
import { parseColor } from '../core/feel';
import type { CardEvent, CardInstance } from '../core/cards';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { CARD_DATA, type CardSystem } from '../systems/cards';
import type { InputMap } from '../systems/input';
import { FACE_H, FACE_W, cardBackKey, cardFaceKey, overlayKey } from './cardFace';
import { PIXEL_FONT } from './pixelFont';

const TAG_NAMES = cardsData.tags as Record<string, string>;
const COL = Object.fromEntries(Object.entries(cardUi.colors).map(([k, v]) => [k, parseColor(v)])) as Record<keyof typeof cardUi.colors, number>;
const FLIP = cardUi.flipMs;
const REJECT_TEXT: Record<string, string> = {
  cooldown: '재정비 중',
  empty: '낼 카드가 없음',
  tooMany: '최대 3장',
  notInHand: '손패에 없음',
  blockedTag: '통신 두절: 정보 카드 사용 불가',
  noSeal: '인장 없음',
  notEnoughOp: 'OP 부족(마이너스 폐기 3)',
  judging: '판정 중',
};

const text = (scene: Phaser.Scene, size: number, color = '#ffffff') =>
  scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: `${size}px`, color, resolution: 2 });

const comboName = (id: string | null | undefined) => CARD_DATA.combos.find((c) => c.id === id)?.name ?? '';
const cardName = (id: string) => CARD_DATA.cards[id]?.name ?? id;

/**
 * 손패 HUD(PRD §5.1·§11 v0.2): 카드 5장, 선택·추천, 최종 성공률 하나, OP·인장, 쿨다운·드로우, 마이너스 타이머,
 * 판정 뒤집기 연출, 작전판(Tab). 상태는 CardSystem(core)이 들고 여기서는 그리기·입력만.
 */
export class CardHud {
  private readonly images = new Map<number, Phaser.GameObjects.Image>();
  private readonly labels = new Map<number, Phaser.GameObjects.BitmapText>();
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly crack: Phaser.GameObjects.Image;
  private readonly info: Phaser.GameObjects.Text;
  private readonly opLabel: Phaser.GameObjects.BitmapText;
  private readonly seals: Phaser.GameObjects.Image[] = [];
  private readonly toast: Phaser.GameObjects.Text;
  private readonly tip: Phaser.GameObjects.Text;
  private hoverUid: number | null = null;
  private toastUntil = 0;
  private judgeView: Phaser.GameObjects.Container | null = null;
  private judgeKey = -1;
  private board: Phaser.GameObjects.Container | null = null;
  private readonly onPointer = (p: Phaser.Input.Pointer) => {
    if (p.rightButtonDown()) this.cards.submit(this.shiftDown(p), this.scene.time.now);
  };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cards: CardSystem,
    private readonly controls: InputMap,
    private readonly host: { pauseForBoard(on: boolean): void; canOpenBoard(): boolean },
  ) {
    this.gfx = scene.add.graphics();
    this.crack = scene.add.image(0, 0, overlayKey(scene, 'overlay_crack')).setVisible(false).setAlpha(0.85);
    this.info = text(scene, 12).setOrigin(0.5, 1);
    this.opLabel = scene.add.bitmapText(0, 0, PIXEL_FONT, 'OP', 7).setLetterSpacing(-1).setScale(2).setOrigin(0, 0.5);
    const sealKey = manifest.image('ui', 'seal', 32, 32).key;
    for (let i = 0; i < CARD_DATA.rules.maxSeals; i++) this.seals.push(scene.add.image(0, 0, sealKey).setScale(0.75));
    this.toast = text(scene, 16, cardUi.colors.success).setOrigin(0.5).setPosition(LOGICAL_WIDTH / 2, 92).setVisible(false);
    this.tip = text(scene, 11, '#e8dcc0').setOrigin(0.5, 1).setVisible(false).setBackgroundColor('#000000c0').setPadding(6, 4, 6, 4);
    scene.input.mouse?.disableContextMenu();
    scene.input.on('pointerdown', this.onPointer);
  }

  private shiftDown(p?: Phaser.Input.Pointer): boolean {
    return this.controls.isDown('modShift') || Boolean((p?.event as MouseEvent | undefined)?.shiftKey);
  }

  /** 카드 효과 알림(조합 스킬 이름 등). 실제 효과는 D09~D11 */
  showEffect(ev: CardEvent): void {
    let msg = '';
    if (ev.type === 'comboSkill') msg = `${comboName(ev.combo)}!`;
    else if (ev.type === 'cardEffect') msg = cardName(ev.card.id);
    else if (ev.type === 'minusTriggered') msg = `${cardName(ev.card.id)} 발동${ev.mult > 1 ? ' ×2' : ''}`;
    else if (ev.type === 'purified') msg = `${cardName(ev.card.id)} 정화`;
    if (!msg) return;
    const color = ev.type === 'minusTriggered' ? cardUi.colors.minus : cardUi.colors.success;
    this.toast.setText(msg).setColor(color).setVisible(true);
    this.toastUntil = this.scene.time.now + 1200;
  }

  update(time: number): void {
    this.handleInput(time);
    const hand = this.cards.state.hand;
    this.syncImages(hand);
    this.layout(hand, time);
    this.updateJudge(time);
    if (this.toast.visible && time > this.toastUntil) this.toast.setVisible(false);
  }

  private handleInput(time: number): void {
    const c = this.controls;
    if (c.justDown('opsBoard')) this.toggleBoard();
    if (this.board) {
      if (c.justDown('pause')) this.toggleBoard();
      return;
    }
    for (let i = 0; i < 5; i++) if (c.justDown(`cardSelect${i + 1}` as 'cardSelect1')) this.cards.toggle(i);
    if (c.justDown('cardSubmit')) this.cards.submit(this.shiftDown(), time);
    if (c.justDown('cardClear')) this.cards.clear();
  }

  private syncImages(hand: readonly CardInstance[]): void {
    const live = new Set(hand.map((c) => c.uid));
    for (const [uid, img] of this.images) {
      if (live.has(uid)) continue;
      img.destroy();
      if (this.hoverUid === uid) this.hoverUid = null;
      this.labels.get(uid)?.destroy();
      this.images.delete(uid);
      this.labels.delete(uid);
    }
    hand.forEach((card) => {
      if (this.images.has(card.uid)) return;
      const def = CARD_DATA.cards[card.id];
      if (!def) return;
      const img = this.scene.add.image(0, 0, cardFaceKey(this.scene, card.id, def)).setInteractive({ useHandCursor: true });
      img.on('pointerover', () => (this.hoverUid = card.uid));
      img.on('pointerout', () => {
        if (this.hoverUid === card.uid) this.hoverUid = null;
      });
      img.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (!p.leftButtonDown()) return;
        const i = this.cards.state.hand.findIndex((h) => h.uid === card.uid);
        if (i >= 0) this.cards.toggle(i);
      });
      this.images.set(card.uid, img);
      this.labels.set(card.uid, this.scene.add.bitmapText(0, 0, PIXEL_FONT, '', 7).setLetterSpacing(-1).setScale(2).setOrigin(0, 1));
    });
  }

  private layout(hand: readonly CardInstance[], time: number): void {
    const H = cardUi.hand;
    const n = hand.length;
    const total = n * FACE_W + Math.max(0, n - 1) * H.gap;
    const x0 = H.centerX - total / 2 + FACE_W / 2;
    const baseY = H.bottom - FACE_H / 2;
    const st = this.cards.state;
    const now = this.cards.env().nowMs;
    const pv = this.cards.preview(this.shiftDown());
    const g = this.gfx.clear();
    const coolLeft = Math.max(0, st.cooldownUntilMs - now);

    hand.forEach((card, i) => {
      const img = this.images.get(card.uid);
      const label = this.labels.get(card.uid);
      if (!img || !label) return;
      const sel = this.cards.selected.includes(card.uid);
      const x = x0 + i * (FACE_W + H.gap);
      const y = baseY - (sel ? H.lift : 0);
      img.setPosition(Math.round(x), Math.round(y)).setVisible(true).setAlpha(coolLeft > 0 && !sel ? 0.6 : 1);
      label.setText(String(i + 1)).setPosition(Math.round(x - FACE_W / 2), Math.round(y - FACE_H / 2 - 1)).setTint(sel ? COL.select : 0xffffff);
      if (sel) g.lineStyle(2, COL.select, 1).strokeRect(Math.round(x - FACE_W / 2) - 1, Math.round(y - FACE_H / 2) - 1, FACE_W + 2, FACE_H + 2);
      // 마이너스 카드: 12초 원형 타이머
      if (CARD_DATA.cards[card.id]?.tag === 'minus') {
        const k = Math.min(1, (now - card.drawnAtMs) / CARD_DATA.rules.minusLifeMs);
        g.lineStyle(3, COL.minus, 0.9).beginPath();
        g.arc(Math.round(x), Math.round(y), 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - k), false).strokePath();
      }
    });

    // 툴팁: 마우스를 올린 카드의 이름·병과·효과(PRD §5.3.1)
    const hover = this.hoverUid !== null ? hand.find((c) => c.uid === this.hoverUid) : undefined;
    const hoverImg = hover ? this.images.get(hover.uid) : undefined;
    if (hover && hoverImg) {
      const d = CARD_DATA.cards[hover.id] as { name: string; tag: string; desc?: string } | undefined;
      this.tip.setText(`${d?.name ?? hover.id} · ${TAG_NAMES[d?.tag ?? ''] ?? ''}\n${d?.desc ?? ''}`).setPosition(hoverImg.x, hoverImg.y - FACE_H / 2 - 20).setVisible(true);
    } else this.tip.setVisible(false);

    // 실패 시 사라질 카드 미리 표시
    const loseImg = pv?.lose !== undefined ? this.images.get(pv.lose) : undefined;
    this.crack.setVisible(Boolean(loseImg));
    if (loseImg) this.crack.setPosition(loseImg.x, loseImg.y).setDepth(loseImg.depth + 1);

    // 안내 줄: 고른 카드 → 조합·성공률 하나 / 아무것도 안 고르면 추천
    // 들린 카드 위 번호(약 15px) 위에 안내 줄
    const top = baseY - FACE_H / 2 - H.lift - 18;
    this.info.setPosition(H.centerX, top).setColor('#ffffff');
    const rej = this.cards.lastReject;
    if (rej && time - rej.atReal < 1000) {
      this.info.setText(REJECT_TEXT[rej.reason] ?? rej.reason).setColor(cardUi.colors.minus);
    } else if (this.cards.judging) {
      this.info.setText('판정 중…');
    } else if (pv) {
      if (pv.discardOnly) this.info.setText(`마이너스 폐기 (OP ${CARD_DATA.rules.minusDiscardOp})  Space`);
      else if (pv.chance) {
        const names = this.cards.selected.map((uid) => cardName(hand.find((c) => c.uid === uid)?.id ?? ''));
        const what = pv.combo ? comboName(pv.combo) : names.length > 1 ? '단일 효과' : (names[0] ?? '');
        const seal = this.shiftDown() ? ' [인장]' : '';
        this.info.setText(`${what} ${Math.round(pv.chance.final * 100)}%${seal}   Space 제출 · X 해제`);
      } else this.info.setText(REJECT_TEXT[pv.reason ?? ''] ?? '');
    } else if (n > 0) {
      const a = this.cards.advice();
      this.info.setText(a ? `Space: 추천 — ${a.combo ? comboName(a.combo) : cardName(hand.find((c) => c.uid === a.uids[0])?.id ?? '')} ${Math.round(a.chance * 100)}%` : '');
    } else this.info.setText('');

    // 쿨다운(손패 위 막대)·드로우 진행(손패 아래 막대)
    const left = H.centerX - Math.max(total, FACE_W * 5 + H.gap * 4) / 2;
    const width = Math.max(total, FACE_W * 5 + H.gap * 4);
    if (coolLeft > 0) {
      g.fillStyle(0x000000, 0.5).fillRect(left, H.bottom + 2, width, 4);
      g.fillStyle(0xd0c0a0, 1).fillRect(left, H.bottom + 2, Math.round((width * coolLeft) / CARD_DATA.rules.submitCooldownMs), 4);
    } else if (n < this.cards.env().handSize) {
      g.fillStyle(0x000000, 0.5).fillRect(left, H.bottom + 2, width, 3);
      g.fillStyle(0x7fd8ff, 1).fillRect(left, H.bottom + 2, Math.round((width * st.drawTimerMs) / CARD_DATA.rules.drawIntervalMs), 3);
    }

    // OP 게이지·인장(손패 왼쪽)
    const ox = left - 96;
    const oy = H.bottom - 30;
    this.opLabel.setPosition(ox, oy - 12);
    const need = this.cards.opForSeal;
    for (let i = 0; i < need; i++) {
      g.fillStyle(i < st.op ? 0xffd34d : 0x3a3020, 1).fillRect(ox + i * 8, oy, 6, 6);
    }
    this.seals.forEach((s, i) => s.setPosition(ox + 8 + i * 26, oy + 24).setAlpha(i < st.seals ? 1 : 0.25));
  }

  /** 판정 뒤집기(실시간 0.6초): 뒤집기 → 뒷면 → 긴장 → 결과 공개, 끝나면 결과 표시 후 사라짐 */
  private updateJudge(time: number): void {
    const j = this.cards.judging;
    if (!j) {
      this.judgeView?.destroy();
      this.judgeView = null;
      return;
    }
    if (!this.judgeView || this.judgeKey !== j.startReal) {
      this.judgeView?.destroy();
      this.judgeKey = j.startReal;
      const view = this.scene.add.container(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 70);
      const n = j.judged.cards.length;
      j.judged.cards.forEach((c, i) => {
        const def = CARD_DATA.cards[c.id];
        const x = (i - (n - 1) / 2) * (FACE_W + 10);
        const img = this.scene.add.image(x, 0, def ? cardFaceKey(this.scene, c.id, def) : cardBackKey(this.scene)).setName(`card${c.uid}`);
        view.add(img);
      });
      const title = text(this.scene, 16).setOrigin(0.5).setPosition(0, -FACE_H / 2 - 16).setName('title');
      view.add(title);
      this.judgeView = view;
    }
    const t = time - j.startReal;
    const view = this.judgeView;
    const title = view.getByName('title') as Phaser.GameObjects.Text;
    const cards = view.list.filter((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image);
    const t1 = FLIP.out;
    const t2 = t1 + FLIP.back;
    const t3 = t2 + FLIP.hold;
    const t4 = t3 + FLIP.reveal;
    const j2 = j;
    cards.forEach((img) => {
      const uid = Number(img.name.slice(4));
      const card = j2.judged.cards.find((c) => c.uid === uid);
      const def = card ? CARD_DATA.cards[card.id] : undefined;
      let sx = 1;
      if (t < t1) sx = 1 - t / t1;
      else if (t < t2) {
        img.setTexture(cardBackKey(this.scene));
        sx = (t - t1) / FLIP.back;
      } else if (t < t3) sx = 1;
      else if (t < t4) {
        const k = (t - t3) / FLIP.reveal;
        if (k < 0.5) sx = 1 - k * 2;
        else {
          if (card && def) img.setTexture(cardFaceKey(this.scene, card.id, def));
          sx = (k - 0.5) * 2;
        }
      }
      img.setScale(Math.max(0.02, sx), 1);
      if (t >= t4) {
        const lost = !j2.judged.success && j2.events.some((e) => e.type === 'lost' && e.card.uid === uid);
        if (j2.judged.success) img.setTintFill(t - t4 < 80 ? 0xffffff : COL.success).setAlpha(Math.max(0, 1 - (t - t4) / cardUi.resultMs));
        else if (lost) img.setTint(0x806050).setAlpha(Math.max(0, 1 - (t - t4) / cardUi.resultMs));
        else img.setAlpha(Math.max(0, 1 - (t - t4) / (cardUi.resultMs * 0.6)));
      } else if (t2 <= t && t < t3) {
        // 긴장: 살짝 떨림
        img.y = Math.round(Math.sin(t * 0.08) * 1.5);
      } else img.y = 0;
    });
    if (t < t4) title.setText(j.judged.seal ? '인장 작전' : `${Math.round(j.judged.chance.final * 100)}%`).setColor('#ffffff');
    else if (j.judged.success) title.setText(j.judged.combo ? `${comboName(j.judged.combo)}!` : '작전 성공').setColor(cardUi.colors.success);
    else {
      const op = j.events.find((e) => e.type === 'opGained');
      const seal = j.events.some((e) => e.type === 'sealGained');
      title.setText(seal ? '실패 · 인장 획득!' : op ? `실패 · OP +1 (${op.type === 'opGained' ? op.op : ''})` : '실패').setColor('#e8dcc0');
    }
  }

  private toggleBoard(): void {
    if (this.board) {
      this.board.destroy();
      this.board = null;
      this.host.pauseForBoard(false);
      return;
    }
    if (!this.host.canOpenBoard()) return;
    this.host.pauseForBoard(true);
    const root = this.scene.add.container(0, 0);
    root.add(this.scene.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.7).setOrigin(0));
    root.add(text(this.scene, 18, cardUi.colors.success).setText('작전판').setPosition(80, 40));
    const recipes = CARD_DATA.combos.map((c) => `${c.name.padEnd(8, ' ')} ${c.tags.map((t) => TAG_NAMES[t] ?? t).join(' + ')}`).join('\n');
    root.add(text(this.scene, 12, '#e8dcc0').setText(`조합표\n${recipes}`).setPosition(80, 76).setLineSpacing(4));
    const pv = this.cards.preview(false);
    const labels: Record<string, string> = { base: '기본', count: '장수', intel: '정보', luck: '행운', extra: '숙련·업그레이드', gamble: '무리수', penalty: '오보', env: '방해' };
    const lines = pv?.chance
      ? [...pv.chance.terms.map((t) => `${labels[t.key] ?? t.key}  ${t.value >= 0 ? '+' : ''}${Math.round(t.value * 100)}%p`), `최종  ${Math.round(pv.chance.final * 100)}% (상한 ${Math.round(CARD_DATA.rules.cap * 100)}%)`]
      : ['카드를 고르면 성공률 내역이 보입니다'];
    const st = this.cards.state;
    const stats = st.stats;
    const rate = stats.submits > 0 ? Math.round((stats.successes / stats.submits) * 100) : 0;
    root.add(
      text(this.scene, 12, '#ffffff')
        .setText(
          [
            '성공률 내역',
            ...lines,
            '',
            `OP ${st.op}/${this.cards.opForSeal} · 인장 ${st.seals}/${CARD_DATA.rules.maxSeals}`,
            `작전 기록  제출 ${stats.submits} · 실제 성공률 ${rate}% · 최장 연패 ${stats.longestFailStreak}`,
            '',
            'Tab 닫기',
          ].join('\n'),
        )
        .setPosition(540, 76)
        .setLineSpacing(4),
    );
    this.board = root;
  }

  get boardOpen(): boolean {
    return this.board !== null;
  }

  destroy(): void {
    this.scene.input.off('pointerdown', this.onPointer);
    for (const img of this.images.values()) img.destroy();
    for (const l of this.labels.values()) l.destroy();
    this.images.clear();
    this.labels.clear();
    this.board?.destroy();
    this.judgeView?.destroy();
  }
}
