import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { hasBackup, loadProfile, loadStatus, restoreBackup, updateProfile } from '../systems/save';
import { startNewGamePlus } from '../core/meta';
import scalingData from '../data/scaling.json';

const MAX_THREAT = scalingData.threat.max;
import { uiText } from '../ui/text';
import { drawTitleScene, drawWarBackdrop } from '../ui/warBackdrop';
import { buttonLabel } from '../ui/buttons';
import { SceneKey } from './keys';
import { t } from '../i18n';
import { params } from '../config/params';
import { playMenuMusic } from '../systems/frontAudio';

/** 레트로 도트 창: 바탕 + 금테(모서리 한 칸 깎음) + 안쪽 그늘 테 + 모서리 리벳 */
function pixelWindow(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.fillStyle(0x0e0708, 0.9).fillRect(x + 2, y + 2, w - 4, h - 4);
  g.fillStyle(0xf0c860, 1).fillRect(x + 2, y, w - 4, 2).fillRect(x + 2, y + h - 2, w - 4, 2).fillRect(x, y + 2, 2, h - 4).fillRect(x + w - 2, y + 2, 2, h - 4);
  g.fillStyle(0x6a3a18, 1).fillRect(x + 2, y + 2, w - 4, 2).fillRect(x + 2, y + h - 4, w - 4, 2).fillRect(x + 2, y + 2, 2, h - 4).fillRect(x + w - 4, y + 2, 2, h - 4);
  g.fillStyle(0xfff0b0, 1);
  for (const [rx, ry] of [[x + 6, y + 6], [x + w - 8, y + 6], [x + 6, y + h - 8], [x + w - 8, y + h - 8]] as const) g.fillRect(rx, ry, 2, 2);
}

/** 메인 메뉴: 노을 전장 그림 배경(ui/warBackdrop drawTitleScene) + 레트로 도트 로고·창 메뉴. 출정 → 작전지도 / 도감 / 설정 */
export class MenuScene extends Phaser.Scene {
  private controls!: InputMap;

  constructor() {
    super(SceneKey.Menu);
  }

  create(): void {
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    const prof = loadProfile();
    const cx = LOGICAL_WIDTH / 2;
    // 배경: 사용자 제공 노을 전장 그림(+ 행군·연기·포격 연출), 없으면 코드로 그린 배경
    if (!drawTitleScene(this)) drawWarBackdrop(this);
    playMenuMusic(this);
    this.drawLogo(cx);
    this.sel = 0;
    const items = [
      { label: t('menu.start'), run: () => this.go() },
      { label: t('codex.title'), run: () => this.scene.start(SceneKey.Codex) },
      { label: t('settings.title'), run: () => this.scene.start(SceneKey.Settings, { back: SceneKey.Menu }) },
      // 엔딩을 봤으면 뉴게임+(위협 등급 +1, 점령만 초기화)
      ...(prof.flags.endingSeen && (prof.threat ?? 0) < MAX_THREAT ? [{ label: t('menu.ngPlus', { n: (prof.threat ?? 0) + 1 }), run: () => this.newGamePlus() }] : []),
      // 세이브가 손상돼 새로 시작했으면 마지막 정상 세이브로 되돌리기(D43)
      ...(loadStatus() === 'corrupt' && hasBackup() ? [{ label: t('menu.restore'), run: () => restoreBackup() && window.location.reload() }] : []),
    ];
    // 레트로 도트 창: 금테(모서리 깎음) + 안쪽 그늘 테 + 리벳, 고른 칸은 띠 + 깜박이는 도트 화살표
    const pw = 300;
    const ph = items.length * 36 + 44;
    const px = Math.round(cx - pw / 2);
    const py = 184;
    pixelWindow(this.add.graphics(), px, py, pw, ph);
    this.bar = this.add.graphics();
    this.cursor = this.add.graphics();
    this.rows = items.map((_, i) => py + 30 + i * 36);
    this.winX = px;
    this.winW = pw;
    this.items = items.map((it, i) => {
      const label = this.add
        .text(px + 40, this.rows[i] ?? 0, it.label, { ...uiText(20, '#e8dcc0'), stroke: '#0a0604', strokeThickness: 4 })
        .setOrigin(0, 0.5)
        .setInteractive({ useHandCursor: true });
      label.on('pointerover', () => {
        if (this.sel !== i) {
          this.sel = i;
          this.renderItems();
        }
      });
      label.on('pointerdown', () => it.run());
      return { ...it, text: label };
    });
    this.add
      .text(cx, py + ph - 14, t('menu.hint', { up: buttonLabel('uiUp'), down: buttonLabel('uiDown'), ok: buttonLabel('uiConfirm') }), uiText(11, '#a89878'))
      .setOrigin(0.5);
    this.time.addEvent({ delay: 380, loop: true, callback: () => this.cursor.setVisible(!this.cursor.visible) });
    this.renderItems();
    if (params.auto) this.time.delayedCall(300, () => this.go());
    const captured = Object.values(prof.stages).filter((s) => s.captured).length;
    const threat = prof.threat ?? 0;
    // 전적 한 줄: 작은 도트 상자
    const sum = this.add
      .text(cx, py + ph + 22, `${t('menu.summary', { captured, merit: prof.merit })}${threat > 0 ? t('menu.threat', { n: threat }) : ''}${prof.bestStep ? t('menu.bestStep', { n: prof.bestStep }) : ''}`, uiText(12, '#f4e4c8'))
      .setOrigin(0.5);
    const sb = this.add.graphics();
    sb.fillStyle(0x0e0708, 0.82).fillRect(Math.round(sum.x - sum.width / 2 - 10), Math.round(sum.y - 11), Math.round(sum.width + 20), 22);
    sb.lineStyle(1, 0x8a6a30, 1).strokeRect(Math.round(sum.x - sum.width / 2 - 10) + 0.5, Math.round(sum.y - 11) + 0.5, Math.round(sum.width + 19), 21);
    sum.setDepth(1);
    // 버전 표기(D45): 오른쪽 아래 구석
    this.add.text(LOGICAL_WIDTH - 8, LOGICAL_HEIGHT - 6, `v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}`, uiText(11, '#807868')).setOrigin(1, 1);
    const status = loadStatus();
    if (status === 'corrupt') this.add.text(cx, LOGICAL_HEIGHT - 20, t('menu.saveCorrupt'), uiText(12, '#ff8060')).setOrigin(0.5);
    else if (status === 'migrated') this.add.text(cx, LOGICAL_HEIGHT - 20, t('menu.saveMigrated'), uiText(12, '#7fd8ff')).setOrigin(0.5);
  }

  private items: { label: string; run: () => void; text: Phaser.GameObjects.Text }[] = [];
  private sel = 0;
  private bar!: Phaser.GameObjects.Graphics;
  private cursor!: Phaser.GameObjects.Graphics;
  private rows: number[] = [];
  private winX = 0;
  private winW = 0;

  /** 고른 칸: 어두운 금빛 띠 + 도트 화살표, 글자는 노랑으로 살짝 오른쪽 */
  private renderItems(): void {
    const y = this.rows[this.sel] ?? 0;
    this.bar.clear().fillStyle(0x4a2a10, 0.95).fillRect(this.winX + 8, y - 13, this.winW - 16, 26).fillStyle(0x8a5a24, 1).fillRect(this.winX + 8, y - 13, this.winW - 16, 1);
    this.cursor.clear().fillStyle(0xffe14d, 1);
    for (let k = 0; k < 4; k++) this.cursor.fillRect(this.winX + 18 + k * 2, y - 4 + k, 2, 8 - k * 2);
    this.cursor.setVisible(true);
    this.items.forEach((it, i) => it.text.setColor(i === this.sel ? '#ffe14d' : '#e8dcc0').setX(this.winX + (i === this.sel ? 42 : 38)));
  }

  /** 제목 로고(레트로 도트): 빨간 연도 리본 → 그림자·두꺼운 외곽선 + 3단 색 띠 글자 → 영문 부제·가칭 → 한 줄 소개 */
  private drawLogo(cx: number): void {
    const year = this.add.text(cx, 24, t('menu.year'), { ...uiText(12, '#fff4e8'), letterSpacing: 4 }).setOrigin(0.5).setDepth(1);
    const rw = Math.round(year.width + 34);
    const rib = this.add.graphics();
    rib.fillStyle(0x6a1410, 1).fillRect(cx - rw / 2 - 10, 20, 12, 12).fillRect(cx + rw / 2 - 2, 20, 12, 12);
    rib.fillStyle(0x1a0606, 1).fillRect(cx - rw / 2 - 1, 15, rw + 2, 19);
    rib.fillStyle(0xb8281e, 1).fillRect(cx - rw / 2, 16, rw, 16);
    rib.fillStyle(0xe85a44, 1).fillRect(cx - rw / 2, 16, rw, 2);
    const title = t('menu.title');
    this.add.text(cx + 5, 84 + 5, title, { ...uiText(56, '#140404'), stroke: '#140404', strokeThickness: 12 }).setOrigin(0.5);
    const main = this.add.text(cx, 84, title, { ...uiText(56, '#ffc040'), stroke: '#2a0804', strokeThickness: 10 }).setOrigin(0.5);
    // 도트 그라데이션: 경계가 딱 끊기는 3단 색(위 밝은 노랑 → 주황 → 아래 짙은 주황)
    const g = main.context.createLinearGradient(0, 0, 0, main.height);
    g.addColorStop(0, '#fff2a8');
    g.addColorStop(0.5, '#fff2a8');
    g.addColorStop(0.5, '#ffc040');
    g.addColorStop(0.7, '#ffc040');
    g.addColorStop(0.7, '#e8701c');
    g.addColorStop(1, '#e8701c');
    main.setFill(g);
    this.add.text(cx, 128, t('menu.titleEn'), { ...uiText(14, '#f4d8a8'), stroke: '#1a0806', strokeThickness: 4, letterSpacing: 6 }).setOrigin(0.5);
    this.add.text(cx + main.width / 2 + 4, 60, t('menu.subtitle'), { ...uiText(11, '#e8c8a0'), stroke: '#1a0806', strokeThickness: 3 }).setOrigin(0, 0.5);
    const tag = this.add.text(cx, 156, t('menu.tagline'), uiText(12, '#f4e4c8')).setOrigin(0.5).setDepth(1);
    this.add.rectangle(cx, 156, tag.width + 24, 20, 0x0e0708, 0.7);
  }

  /** 뉴게임+: 위협 등급을 올리고 지도부터(해금·스타팅 포인트·전공은 그대로) */
  private newGamePlus(): void {
    updateProfile((d) => {
      const r = startNewGamePlus(d, MAX_THREAT);
      return r.ok ? r.save : d;
    });
    this.go();
  }

  private go(): void {
    this.scene.start(SceneKey.Map, {});
  }

  override update(): void {
    const c = this.controls;
    // 이동과 확인이 한 프레임에 같이 와도(빠른 입력) 둘 다 처리
    const n = this.items.length;
    const up = c.justDown('uiUp');
    const down = c.justDown('uiDown');
    if (up || down) {
      this.sel = (this.sel + (up ? n - 1 : 1)) % n;
      this.renderItems();
    }
    if (c.justDown('uiConfirm')) this.items[this.sel]?.run();
    this.controls.endFrame();
  }
}
