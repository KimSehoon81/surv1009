import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { hasBackup, loadProfile, loadStatus, restoreBackup, updateProfile } from '../systems/save';
import { startNewGamePlus } from '../core/meta';
import scalingData from '../data/scaling.json';

const MAX_THREAT = scalingData.threat.max;
import { uiText } from '../ui/text';
import { drawWarBackdrop } from '../ui/warBackdrop';
import { SceneKey } from './keys';
import { t } from '../i18n';
import { params } from '../config/params';

/** 메인 메뉴: 노을 진 전장 배경(ui/warBackdrop) + 제목 로고 + 군용 판 메뉴. 출정 → 작전지도 / 도감 / 설정 */
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
    drawWarBackdrop(this);
    // 제목 로고: 연도 띠 + 큰 글씨(두꺼운 외곽선·그림자) + 가칭
    this.add.text(cx, 34, t('menu.year'), { ...uiText(14, '#ff6a50'), stroke: '#1a0a08', strokeThickness: 4, letterSpacing: 6 }).setOrigin(0.5);
    this.add.text(cx + 3, 85, t('menu.title'), { ...uiText(48, '#2a0a06') }).setOrigin(0.5);
    this.add.text(cx, 82, t('menu.title'), { ...uiText(48, '#ffd84a'), stroke: '#3a1206', strokeThickness: 8 }).setOrigin(0.5);
    this.add.text(cx + 150, 116, t('menu.subtitle'), { ...uiText(12, '#e8c8a0'), stroke: '#1a0a08', strokeThickness: 3 }).setOrigin(0.5);
    // 첫 화면에서 무엇을 하는 게임인지 한 줄(몰입·목적 전달)
    this.add.text(cx, 146, t('menu.tagline'), { ...uiText(13, '#f4e4c8'), stroke: '#1a0a08', strokeThickness: 4 }).setOrigin(0.5);
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
    // 군용 판: 어두운 판 + 놋쇠색 테두리 + 모서리 리벳
    const ph = items.length * 34 + 24;
    const py = 196;
    const plate = this.add.graphics();
    plate.fillStyle(0x140c0a, 0.82).fillRect(cx - 140, py, 280, ph);
    plate.lineStyle(2, 0xc8a060, 1).strokeRect(cx - 140, py, 280, ph);
    plate.lineStyle(1, 0x6a4a2a, 1).strokeRect(cx - 135, py + 5, 270, ph - 10);
    for (const [rx, ry] of [[cx - 134, py + 6], [cx + 133, py + 6], [cx - 134, py + ph - 7], [cx + 133, py + ph - 7]]) plate.fillStyle(0xc8a060, 1).fillRect((rx ?? 0) - 1, (ry ?? 0) - 1, 3, 3);
    this.items = items.map((it, i) => {
      const label = this.add.text(cx, py + 28 + i * 34, '', { ...uiText(20, '#ffffff'), stroke: '#0a0604', strokeThickness: 3 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      label.on('pointerdown', () => it.run());
      return { ...it, text: label };
    });
    this.renderItems();
    if (params.auto) this.time.delayedCall(300, () => this.go());
    const captured = Object.values(prof.stages).filter((s) => s.captured).length;
    const threat = prof.threat ?? 0;
    this.add.text(cx, py + ph + 18, `${t('menu.summary', { captured, merit: prof.merit })}${threat > 0 ? t('menu.threat', { n: threat }) : ''}${prof.bestStep ? t('menu.bestStep', { n: prof.bestStep }) : ''}`, { ...uiText(13, '#f4e4c8'), stroke: '#0a0604', strokeThickness: 4 }).setOrigin(0.5);
    // 버전 표기(D45): 오른쪽 아래 구석
    this.add.text(LOGICAL_WIDTH - 8, LOGICAL_HEIGHT - 6, `v${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}`, uiText(11, '#807868')).setOrigin(1, 1);
    const status = loadStatus();
    if (status === 'corrupt') this.add.text(cx, LOGICAL_HEIGHT - 20, t('menu.saveCorrupt'), uiText(12, '#ff8060')).setOrigin(0.5);
    else if (status === 'migrated') this.add.text(cx, LOGICAL_HEIGHT - 20, t('menu.saveMigrated'), uiText(12, '#7fd8ff')).setOrigin(0.5);
  }

  private items: { label: string; run: () => void; text: Phaser.GameObjects.Text }[] = [];
  private sel = 0;

  private renderItems(): void {
    this.items.forEach((it, i) => it.text.setText(`${i === this.sel ? '▶ ' : '  '}${it.label}`).setColor(i === this.sel ? '#ffe14d' : '#e8dcc0'));
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
