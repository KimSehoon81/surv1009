import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { loadProfile, loadStatus } from '../systems/save';
import { uiText } from '../ui/text';
import { SceneKey } from './keys';

/** 메인 메뉴(임시, 정식 화면은 목업 수령 후): 출정 → 작전지도 */
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
    this.add.text(cx, 200, '가칭 · 수직 슬라이스', uiText(13, '#b0a890')).setOrigin(0.5);
    const start = this.add.text(cx, 300, '▶ 출정  (Enter)', uiText(20, '#ffffff')).setOrigin(0.5).setInteractive({ useHandCursor: true });
    start.on('pointerdown', () => this.go());
    const captured = Object.values(prof.stages).filter((s) => s.captured).length;
    this.add.text(cx, 350, `점령 ${captured}/10 · 전공 포인트 ${prof.merit}`, uiText(13)).setOrigin(0.5);
    const status = loadStatus();
    if (status === 'corrupt') this.add.text(cx, LOGICAL_HEIGHT - 40, '세이브가 손상되어 백업해 두고 새로 시작했습니다', uiText(12, '#ff8060')).setOrigin(0.5);
    else if (status === 'migrated') this.add.text(cx, LOGICAL_HEIGHT - 40, '이전 저장을 새 형식으로 옮겼습니다', uiText(12, '#7fd8ff')).setOrigin(0.5);
  }

  private go(): void {
    this.scene.start(SceneKey.Map, {});
  }

  override update(): void {
    if (this.controls.justDown('uiConfirm')) this.go();
    this.controls.endFrame();
  }
}
