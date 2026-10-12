import * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import levels from '../data/levels.json';
import upgradesData from '../data/upgrades.json';
import { manifest } from '../assets/manifest';
import { parseColor } from '../core/feel';
import { describe as describeUpgrade, type Choice } from '../core/upgrades';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap, type InputAction } from '../systems/input';
import { PIXEL_FONT, ensurePixelFont } from '../ui/pixelFont';
import { CardHud } from '../ui/cardHud';
import type { CardEvent } from '../core/cards';
import type { BattleScene } from './BattleScene';
import { SceneKey } from './keys';

const RARITY = upgradesData.rarity;
const PICK_KEYS: InputAction[] = ['levelPick1', 'levelPick2', 'levelPick3', 'levelPick4'];
const CARD_W = 200;
const CARD_H = 150;
const CARD_GAP = 16;

const textStyle = (size: number, color = '#ffffff'): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: 'monospace',
  fontSize: `${size}px`,
  color,
  resolution: 2,
});

/**
 * 전투 위에 겹쳐 도는 화면 고정 UI(PRD §11). 전투 카메라의 줌 펀치·흔들림을 받지 않는다.
 * 전투 상태는 BattleScene에서 읽기만 하고, 레벨업 선택만 BattleScene 메서드로 돌려준다.
 */
export class HudScene extends Phaser.Scene {
  private battle!: BattleScene;
  private controls!: InputMap;
  private lvText!: Phaser.GameObjects.BitmapText;
  private xpBar!: Phaser.GameObjects.Graphics;
  private comboText!: Phaser.GameObjects.BitmapText;
  private comboCount = 0;
  private comboBumpAt = -Infinity;
  private pauseText!: Phaser.GameObjects.Text;
  private ownedText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  private levelUp: Phaser.GameObjects.Container | null = null;
  private cardHud!: CardHud;
  private readonly onCardEffect = (ev: CardEvent) => this.cardHud.showEffect(ev);
  private readonly onToast = (msg: string, color?: string) => this.cardHud.showText(msg, color);
  private levelUpOpenedAt = 0;
  private readonly onLevelUp = (choices: Choice[]) => this.showLevelUp(choices);
  private readonly onLevelUpClosed = () => this.hideLevelUp();

  constructor() {
    super(SceneKey.Hud);
  }

  create(): void {
    this.battle = this.scene.get(SceneKey.Battle) as BattleScene;
    this.controls = new InputMap(this);
    ensurePixelFont(this);

    this.lvText = this.add.bitmapText(12, 10, PIXEL_FONT, 'LV 1', 7).setLetterSpacing(-1).setScale(2);
    this.xpBar = this.add.graphics();
    const c = feelData.combo;
    this.comboText = this.add
      .bitmapText(c.x, c.y, PIXEL_FONT, '', 7)
      .setLetterSpacing(-1)
      .setOrigin(1, 0)
      .setScale(c.scale)
      .setTint(parseColor(c.color))
      .setVisible(false);

    const panel = { ...textStyle(16), align: 'center', backgroundColor: '#000000b0', padding: { x: 12, y: 8 } };
    this.pauseText = this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 - 40, '일시정지\nEsc로 계속', panel).setOrigin(0.5).setVisible(false);
    this.ownedText = this.add
      .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 20, '', { ...textStyle(12, '#e8dcc0'), align: 'center', wordWrap: { width: 560 } })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.bannerText = this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, '', panel).setOrigin(0.5).setVisible(false);

    this.cardHud = new CardHud(this, this.battle.cards, this.controls, {
      pauseForBoard: (on) => this.battle.setOpsBoard(on),
      canOpenBoard: () => this.battle.canOpenBoard(),
    });
    this.battle.events.on('cards:effect', this.onCardEffect);
    this.battle.events.on('toast', this.onToast);
    this.battle.events.on('levelup', this.onLevelUp);
    this.battle.events.on('levelupClosed', this.onLevelUpClosed);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.battle.events.off('levelup', this.onLevelUp);
      this.battle.events.off('levelupClosed', this.onLevelUpClosed);
      this.battle.events.off('cards:effect', this.onCardEffect);
      this.battle.events.off('toast', this.onToast);
      this.cardHud.destroy();
      this.controls.destroy();
    });
    // 전투가 먼저 레벨업 창을 열어 둔 상태에서 HUD가 다시 시작된 경우
    const open = this.battle.progression?.choices;
    if (open) this.showLevelUp(open);
  }

  override update(time: number): void {
    const b = this.battle;
    if (!b.progression) return;
    this.drawXp();

    // 콤보: 늘어날 때 1.3배로 튀었다가 0.2초에 걸쳐 원래 크기로
    const n = b.feel.combo.count;
    if (n > this.comboCount) this.comboBumpAt = time;
    this.comboCount = n;
    const show = n >= feelData.combo.minShow;
    this.comboText.setVisible(show);
    if (show) {
      const k = Math.min(1, (time - this.comboBumpAt) / 200);
      this.comboText.setText(`${n} COMBO`).setScale(feelData.combo.scale * (1 + 0.3 * (1 - k)));
    }

    const paused = b.clock.hasScale('pause') && !b.run.defeated && !b.opsOpen;
    this.pauseText.setVisible(paused);
    this.ownedText.setVisible(paused).setText(paused ? this.ownedSummary() : '');
    this.bannerText.setVisible(b.bannerMessage !== null).setText(b.bannerMessage ?? '');

    if (this.levelUp) this.updateLevelUp(time);
    else this.cardHud.update(time);
    this.controls.endFrame();
  }

  private drawXp(): void {
    const p = this.battle.progression;
    this.lvText.setText(`LV ${p.level}`);
    const g = this.xpBar.clear();
    const x = 64;
    const y = 14;
    const w = 300;
    g.fillStyle(0x1a1410, 0.9).fillRect(x - 1, y - 1, w + 2, 8);
    g.fillStyle(0x3a3020, 1).fillRect(x, y, w, 6);
    g.fillStyle(0x7fd8ff, 1).fillRect(x, y, Math.round(w * p.progress), 6);
  }

  /** 일시정지 화면: 지금까지 고른 업그레이드 */
  private ownedSummary(): string {
    const owned = this.battle.progression.owned;
    const names = Object.entries(owned)
      .filter(([, lv]) => lv > 0)
      .map(([id, lv]) => {
        const def = upgradesData.upgrades.find((u) => u.id === id);
        return def ? (def.maxLevel > 1 ? `${def.name} ${lv}` : def.name) : id;
      });
    return names.length > 0 ? `획득한 업그레이드\n${names.join(' · ')}` : '';
  }

  private showLevelUp(choices: Choice[]): void {
    this.hideLevelUp();
    const p = this.battle.progression;
    const root = this.add.container(0, 0);
    root.add(this.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.55).setOrigin(0));
    root.add(this.add.text(LOGICAL_WIDTH / 2, 120, `레벨 업!  Lv ${p.level - p.pending + 1}`, textStyle(22, '#ffe14d')).setOrigin(0.5));
    const total = choices.length * CARD_W + (choices.length - 1) * CARD_GAP;
    const x0 = (LOGICAL_WIDTH - total) / 2;
    const y0 = 190;
    choices.forEach((c, i) => {
      const x = x0 + i * (CARD_W + CARD_GAP);
      const card = this.add.container(x, y0);
      const color = parseColor(RARITY.colors[c.rarity as keyof typeof RARITY.colors]);
      const bg = this.add.rectangle(0, 0, CARD_W, CARD_H, 0x1a1610, 0.94).setOrigin(0).setStrokeStyle(2, color);
      const icon = this.add.image(40, 44, manifest.image('ui', c.def.icon, 32, 32).key).setScale(2);
      const name = this.add.text(76, 22, c.def.name, textStyle(16));
      const rarity = this.add.text(76, 44, c.fallback ? '보급' : RARITY.names[c.rarity as keyof typeof RARITY.names], textStyle(12, RARITY.colors[c.rarity as keyof typeof RARITY.colors]));
      const desc = this.add.text(12, 84, describeUpgrade(c.def, c.mods), { ...textStyle(12, '#e8dcc0'), wordWrap: { width: CARD_W - 24 } });
      const key = this.add.text(8, 6, String(i + 1), textStyle(12, '#ffe14d')).setName('key');
      card.add([bg, icon, name, rarity, desc, key]);
      bg.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.pick(i));
      root.add(card);
    });
    const rr = this.add
      .text(LOGICAL_WIDTH / 2, y0 + CARD_H + 30, '', textStyle(13, p.rerolls > 0 ? '#ffffff' : '#807868'))
      .setOrigin(0.5)
      .setName('reroll');
    rr.setText(p.rerolls > 0 ? `R  다시 뽑기 (남은 ${p.rerolls})` : '다시 뽑기 없음');
    if (p.rerolls > 0) rr.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.reroll());
    root.add(rr);
    root.add(this.add.text(LOGICAL_WIDTH / 2, y0 + CARD_H + 56, `${p.pending > 1 ? `레벨업 ${p.pending}번 남음 · ` : ''}숫자키 또는 클릭으로 선택`, textStyle(11, '#b0a890')).setOrigin(0.5));
    this.levelUp = root;
    this.levelUpOpenedAt = this.time.now;
    root.setAlpha(0.4);
  }

  /** 열린 직후 입력 잠금(PRD §3: 카드 숫자키 오입력 방지). 잠금 동안 반투명 */
  private get locked(): boolean {
    return this.time.now - this.levelUpOpenedAt < levels.inputLockMs;
  }

  private updateLevelUp(time: number): void {
    const root = this.levelUp;
    if (!root) return;
    const k = Math.min(1, (time - this.levelUpOpenedAt) / levels.inputLockMs);
    root.setAlpha(0.4 + 0.6 * k);
    if (this.locked) return;
    PICK_KEYS.forEach((a, i) => {
      if (this.controls.justDown(a)) this.pick(i);
    });
    if (this.controls.justDown('levelReroll')) this.reroll();
  }

  private pick(i: number): void {
    if (this.locked || !this.levelUp) return;
    this.battle.pickUpgrade(i);
  }

  private reroll(): void {
    if (this.locked || !this.levelUp) return;
    this.battle.rerollUpgrade();
  }

  private hideLevelUp(): void {
    this.levelUp?.destroy();
    this.levelUp = null;
  }
}
