import * as Phaser from 'phaser';
import { manifest, type SheetSpec } from '../assets/manifest';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { GameClock } from '../systems/clock';
import { ensureSheetAnim } from '../systems/anims';
import { DebugOverlay } from '../systems/debugOverlay';
import { SceneKey } from './keys';

/** 전투 씬 골격. D02부터 플레이어·바닥·적이 붙는다 */
export class BattleScene extends Phaser.Scene {
  readonly clock = new GameClock();
  private debug!: DebugOverlay;
  private hero!: Phaser.GameObjects.Sprite;
  private heroSheets: SheetSpec[] = [];
  private actionIndex = 0;
  private actionTimer = 0;

  constructor() {
    super(SceneKey.Battle);
  }

  create(): void {
    this.clock.reset();
    this.add
      .tileSprite(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, manifest.tile('T01').key)
      .setOrigin(0);

    // 자리표시자 확인용: A01의 동작을 2초마다 순환 재생
    this.heroSheets = manifest.unitSheets('A01');
    for (const sheet of this.heroSheets) ensureSheetAnim(this, sheet);
    const first = this.heroSheets[0];
    if (!first) throw new Error('A01 시트 없음');
    this.hero = this.add
      .sprite(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 30, first.key, 0)
      .setOrigin(manifest.anchor.x, manifest.anchor.y);
    this.playAction(0);

    this.debug = new DebugOverlay(this, this.clock);
  }

  override update(_time: number, delta: number): void {
    const dt = this.clock.tick(delta);
    this.actionTimer += dt;
    if (this.actionTimer >= 2000) {
      this.actionTimer = 0;
      this.playAction(this.actionIndex + 1);
    }
    this.debug.update(delta);
  }

  private playAction(index: number): void {
    this.actionIndex = index % this.heroSheets.length;
    const sheet = this.heroSheets[this.actionIndex];
    if (sheet) this.hero.play(sheet.key);
  }
}
