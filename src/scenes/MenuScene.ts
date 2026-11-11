import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { loadProfile, loadStatus, updateProfile } from '../systems/save';
import { startNewGamePlus } from '../core/meta';
import scalingData from '../data/scaling.json';

const MAX_THREAT = scalingData.threat.max;
import { uiText } from '../ui/text';
import { SceneKey } from './keys';

/** 메인 메뉴(임시, 정식 화면은 목업 수령 후 — docs/mockup/main.png 대기): 출정 → 작전지도 / 설정 */
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
    this.add.text(cx, 150, '압록강 서바이벌', uiText(40, '#ffe14d')).setOrigin(0.5);
    this.add.text(cx, 200, '가칭', uiText(13, '#b0a890')).setOrigin(0.5);
    this.sel = 0;
    this.items = [
      { label: '출정', run: () => this.go() },
      { label: '설정', run: () => this.scene.start(SceneKey.Settings, { back: SceneKey.Menu }) },
      // 엔딩을 봤으면 뉴게임+(위협 등급 +1, 점령만 초기화)
      ...(prof.flags.endingSeen && (prof.threat ?? 0) < MAX_THREAT ? [{ label: `뉴게임+  위협 등급 ${(prof.threat ?? 0) + 1}`, run: () => this.newGamePlus() }] : []),
    ].map((it, i) => {
      const t = this.add.text(cx, 290 + i * 30, '', uiText(20, '#ffffff')).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => it.run());
      return { ...it, text: t };
    });
    this.renderItems();
    const captured = Object.values(prof.stages).filter((s) => s.captured).length;
    const t = prof.threat ?? 0;
    this.add.text(cx, 290 + this.items.length * 30 + 20, `점령 ${captured}/10 · 전공 포인트 ${prof.merit}${t > 0 ? ` · 위협 등급 ${t}` : ''}${prof.bestStep ? ` · 최고 단계 ${prof.bestStep}/100` : ''}`, uiText(13)).setOrigin(0.5);
    const status = loadStatus();
    if (status === 'corrupt') this.add.text(cx, LOGICAL_HEIGHT - 40, '세이브가 손상되어 백업해 두고 새로 시작했습니다', uiText(12, '#ff8060')).setOrigin(0.5);
    else if (status === 'migrated') this.add.text(cx, LOGICAL_HEIGHT - 40, '이전 저장을 새 형식으로 옮겼습니다', uiText(12, '#7fd8ff')).setOrigin(0.5);
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
