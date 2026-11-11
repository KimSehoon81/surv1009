import * as Phaser from 'phaser';
import endingData from '../data/ending.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { uiText } from '../ui/text';
import { UI } from '../ui/widgets';
import { SceneKey } from './keys';

/** 엔딩(D38): 문장이 차례로 → 참전국 크레딧 → 뉴게임+ 안내. Enter·클릭이면 다음 문장을 바로, 끝나면 메뉴로 */
export class EndingScene extends Phaser.Scene {
  private controls!: InputMap;
  private shown = 0;
  private texts: Phaser.GameObjects.Text[] = [];
  private nextAt = 0;
  private done = false;

  constructor() {
    super(SceneKey.Ending);
  }

  create(): void {
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    this.shown = 0;
    this.done = false;
    this.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x0c0a08).setOrigin(0);
    this.add.text(LOGICAL_WIDTH / 2, 70, endingData.title, uiText(30, UI.hi)).setOrigin(0.5);
    const all = [...endingData.lines, '', endingData.creditsTitle, ...endingData.credits, '', endingData.newGamePlus];
    // 줄바꿈된 줄도 겹치지 않게 앞 글의 높이만큼 내려 쌓는다
    let y = 130;
    this.texts = all.map((t, i) => {
      const o = this.add
        .text(LOGICAL_WIDTH / 2, y, t, { ...uiText(i >= endingData.lines.length ? 13 : 16, i === all.length - 1 ? UI.hi : UI.text), align: 'center', wordWrap: { width: 820 } })
        .setOrigin(0.5, 0)
        .setAlpha(0);
      y += Math.max(18, o.height + 10);
      return o;
    });
    this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 24, 'Enter  넘기기 · 끝나면 메뉴로', uiText(11, UI.dim)).setOrigin(0.5);
    this.input.on('pointerdown', () => this.advance());
    this.nextAt = this.time.now + 600;
  }

  private advance(): void {
    if (this.done) {
      this.scene.start(SceneKey.Menu);
      return;
    }
    const t = this.texts[this.shown++];
    if (t) this.tweens.add({ targets: t, alpha: 1, duration: 600 });
    if (this.shown >= this.texts.length) this.done = true;
    this.nextAt = this.time.now + endingData.lineMs;
  }

  override update(time: number): void {
    if (this.controls.justDown('uiConfirm')) this.advance();
    else if (!this.done && time >= this.nextAt) this.advance();
    this.controls.endFrame();
  }
}
