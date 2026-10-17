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
import { cardBackKey } from '../ui/cardFace';
import enemiesData from '../data/enemies.json';
import type { Enemy } from '../entities/Enemy';
import { SkillHud } from '../ui/skillHud';
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
  private skillHud!: SkillHud;
  /** 예고(엘리트·방해·보스): 문구와 끝 시각(전투 시계) */
  private warnText!: Phaser.GameObjects.Text;
  private warn: { msg: string; untilMs: number } | null = null;
  private bossGfx!: Phaser.GameObjects.Graphics;
  private bossName!: Phaser.GameObjects.Text;
  private bossCard!: Phaser.GameObjects.Image;
  private bossInfo!: Phaser.GameObjects.Text;
  private bossJudge: { msg: string; color: string; untilReal: number } | null = null;
  private resultPanel: Phaser.GameObjects.Container | null = null;
  private readonly onWarn = (msg: string, inSec: number) => {
    this.warn = { msg, untilMs: this.battle.clock.timeMs + inSec * 1000 };
  };
  private readonly onBossJudged = (result: string) => {
    const t = this.time.now + 1600;
    if (result === 'success') this.bossJudge = { msg: '적 작전 성공 — 대형 포격 예고!', color: '#ff6050', untilReal: t };
    else this.bossJudge = { msg: result === 'cancel' ? '충전 취소 — 약점 노출!' : '적 작전 실패 — 약점 노출!', color: '#ffe14d', untilReal: t };
  };
  private readonly onResult = () => this.showResult();
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
      // 포연: 40~70% 사이로 일렁임
      smoke: () => (this.battle.disruptions.has('smoke') ? 0.55 + 0.15 * Math.sin(this.time.now / 300) : 0),
    });
    this.warnText = this.add.text(LOGICAL_WIDTH / 2, 66, '', { ...textStyle(16, '#ff8060'), stroke: '#1a1410', strokeThickness: 3 }).setOrigin(0.5).setVisible(false);
    this.bossGfx = this.add.graphics();
    this.bossName = this.add.text(LOGICAL_WIDTH / 2, 30, '', { ...textStyle(12, '#ffd0c0'), stroke: '#1a1410', strokeThickness: 3 }).setOrigin(0.5, 1).setVisible(false);
    this.bossCard = this.add.image(LOGICAL_WIDTH / 2, 92, cardBackKey(this)).setVisible(false);
    this.bossInfo = this.add.text(LOGICAL_WIDTH / 2, 142, '', { ...textStyle(12, '#ffe14d'), stroke: '#1a1410', strokeThickness: 3 }).setOrigin(0.5).setVisible(false);
    this.battle.events.on('warn', this.onWarn);
    this.battle.events.on('boss:judged', this.onBossJudged);
    this.battle.events.on('result', this.onResult);
    this.skillHud = new SkillHud(this, this.battle.skills, () => this.battle.clock.timeMs);
    this.battle.events.on('cards:effect', this.onCardEffect);
    this.battle.events.on('toast', this.onToast);
    this.battle.events.on('levelup', this.onLevelUp);
    this.battle.events.on('levelupClosed', this.onLevelUpClosed);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.battle.events.off('levelup', this.onLevelUp);
      this.battle.events.off('levelupClosed', this.onLevelUpClosed);
      this.battle.events.off('cards:effect', this.onCardEffect);
      this.battle.events.off('toast', this.onToast);
      this.battle.events.off('warn', this.onWarn);
      this.battle.events.off('boss:judged', this.onBossJudged);
      this.battle.events.off('result', this.onResult);
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

    this.skillHud.update();
    this.drawWarn(time);
    this.drawBoss(time);
    if (this.resultPanel) {
      if (this.controls.justDown('redeploy')) b.redeploy();
    } else if (this.levelUp) this.updateLevelUp(time);
    else this.cardHud.update(time);
    this.controls.endFrame();
  }

  /** 예고 문구 + 남은 초(마지막 3초는 깜빡임) */
  private drawWarn(time: number): void {
    const w = this.warn;
    const left = w ? (w.untilMs - this.battle.clock.timeMs) / 1000 : 0;
    if (!w || left <= 0) {
      this.warnText.setVisible(false);
      this.warn = null;
      return;
    }
    this.warnText.setText(`⚠ ${w.msg}  ${Math.ceil(left)}`).setVisible(left > 3 || Math.floor(time / 200) % 2 === 0);
  }

  /** 보스 체력바 + 작전 카드(충전·취소 게이지·판정 결과) */
  private drawBoss(time: number): void {
    const e: Enemy | null = this.battle.boss;
    const g = this.bossGfx.clear();
    const show = e !== null && e.alive;
    this.bossName.setVisible(show);
    if (!show || !e) {
      this.bossCard.setVisible(false);
      this.bossInfo.setVisible(false);
      return;
    }
    const w = 360;
    const x = LOGICAL_WIDTH / 2 - w / 2;
    const y = 34;
    this.bossName.setText((enemiesData.enemies as Record<string, { name: string }>)[e.id]?.name ?? e.id);
    g.fillStyle(0x1a1410, 0.9).fillRect(x - 2, y - 2, w + 4, 10);
    g.fillStyle(0x3a1a14, 1).fillRect(x, y, w, 6);
    g.fillStyle(0xd84030, 1).fillRect(x, y, Math.round((w * Math.max(0, e.hp)) / e.maxHp), 6);
    const spec = e.atk.index >= 0 ? e.attacks[e.atk.index] : undefined;
    const charging = spec?.type === 'opCard' && e.atk.phase === 'windup';
    this.bossCard.setVisible(charging).setScale(0.5);
    if (charging && spec) {
      const k = 1 - Math.max(0, e.atk.phaseLeftMs) / Math.max(1, spec.windupMs ?? 1);
      const cancel = Math.min(1, e.atk.chargeDamage / (spec.cancelFrac ?? 1));
      // 충전(붉은 막대)·취소 게이지(금색 막대)
      g.fillStyle(0x1a1410, 0.9).fillRect(LOGICAL_WIDTH / 2 - 32, 128, 64, 10);
      g.fillStyle(0xff5040, 1).fillRect(LOGICAL_WIDTH / 2 - 31, 129, Math.round(62 * k), 3);
      g.fillStyle(0xffd040, 1).fillRect(LOGICAL_WIDTH / 2 - 31, 134, Math.round(62 * cancel), 3);
      this.bossCard.setAlpha(0.7 + 0.3 * Math.abs(Math.sin(time / 120)));
      this.bossInfo.setText('적 작전 카드 충전 — 집중 사격으로 취소!').setColor('#ffe14d').setPosition(LOGICAL_WIDTH / 2, 150).setVisible(true);
    } else if (this.bossJudge && time < this.bossJudge.untilReal) {
      this.bossInfo.setText(this.bossJudge.msg).setColor(this.bossJudge.color).setPosition(LOGICAL_WIDTH / 2, 62).setVisible(true);
    } else this.bossInfo.setVisible(false);
  }

  /** 결과 화면(점령·전사): 기록·전공 포인트·팁, Enter 다시 출정 */
  private showResult(): void {
    const r = this.battle.result;
    if (!r || this.resultPanel) return;
    this.hideLevelUp();
    const rec = r.record;
    const root = this.add.container(0, 0);
    root.add(this.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x000000, 0.7).setOrigin(0));
    const title = rec.victory ? `${this.battle.stage.name} 점령` : '전사';
    root.add(this.add.text(LOGICAL_WIDTH / 2, 86, title, textStyle(26, rec.victory ? '#ffe14d' : '#ff8060')).setOrigin(0.5));
    const mm = Math.floor(rec.timeSec / 60);
    const ss = String(Math.floor(rec.timeSec % 60)).padStart(2, '0');
    const lines = [
      `시간 ${mm}:${ss}    레벨 ${rec.level}    처치 ${rec.kills}${rec.eliteKills > 0 ? ` (엘리트 ${rec.eliteKills})` : ''}`,
      `전공 포인트 +${r.merit}${rec.victory ? '' : '  (전사: 50%)'}`,
      '',
      '작전 기록',
      `제출 ${rec.submits}회 · 실제 성공률 ${r.rate}% · 최장 연패 ${rec.longestFailStreak} · 인장 사용 ${rec.sealsUsed} · 잔효 피해 ${rec.residueDamage}`,
    ];
    root.add(this.add.text(LOGICAL_WIDTH / 2, 140, lines.join('\n'), { ...textStyle(14, '#e8dcc0'), align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0));
    if (r.tip) root.add(this.add.text(LOGICAL_WIDTH / 2, 320, `팁: ${r.tip}`, { ...textStyle(13, '#7fd8ff'), align: 'center', wordWrap: { width: 640 } }).setOrigin(0.5, 0));
    const again = this.add.text(LOGICAL_WIDTH / 2, 400, 'Enter  다시 출정 (같은 구성)', textStyle(16, '#ffffff')).setOrigin(0.5);
    again.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.battle.redeploy());
    root.add(again);
    root.setAlpha(0);
    this.tweens.add({ targets: root, alpha: 1, duration: 300 });
    this.resultPanel = root;
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
