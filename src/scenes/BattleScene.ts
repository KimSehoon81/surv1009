import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Depth } from '../config/depth';
import { params } from '../config/params';
import { GameClock } from '../systems/clock';
import { DebugOverlay } from '../systems/debugOverlay';
import { Floor, type FloorConfig } from '../systems/floor';
import { InputMap } from '../systems/input';
import { Player, isCharacterId, type CharacterId } from '../entities/Player';
import { SceneKey } from './keys';

const CHARACTERS: CharacterId[] = ['A01', 'A02', 'A03'];
const DEBUG_SLOW = 0.4;

/** 전투 씬. D02: 플레이어 이동·애니메이션·무한 바닥·일시정지. D03부터 적이 붙는다 */
export class BattleScene extends Phaser.Scene {
  readonly clock = new GameClock();
  private controls!: InputMap;
  private player!: Player;
  private floor!: Floor;
  private debug!: DebugOverlay;
  private pauseText!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Battle);
  }

  create(): void {
    this.clock.reset();
    this.controls = new InputMap(this);
    this.floor = new Floor(this, floorData.S1 satisfies FloorConfig, params.seed);

    const start: CharacterId = isCharacterId(params.char) ? params.char : 'A01';
    this.player = new Player(this, 0, 0, start);
    this.player.sprite.setDepth(Depth.Unit);
    this.cameras.main.startFollow(this.player.sprite, true);
    this.cameras.main.centerOn(0, 0);

    this.pauseText = this.add
      .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, '일시정지\nEsc로 계속', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        align: 'center',
        backgroundColor: '#000000b0',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(Depth.Ui)
      .setVisible(false);

    this.debug = new DebugOverlay(this, this.clock, params.debug, () => {
      const f = this.floor.stats;
      return [
        `player ${this.player.id} ${this.player.action} (${Math.round(this.player.x)}, ${Math.round(this.player.y)}) speed x${this.player.speedMul}`,
        `floor chunks ${f.chunks} pool ${f.pooled}`,
        params.debug ? 'J공격 K방어 L스킬 U치명 O느림 C캐릭터 Esc정지' : '',
      ].filter(Boolean);
    });
  }

  override update(_time: number, delta: number): void {
    if (this.controls.justDown('pause')) this.togglePause();
    const dt = this.clock.tick(delta);
    const now = this.clock.timeMs;
    if (params.debug && !this.clock.hasScale('pause')) this.debugKeys(now);
    this.player.update(this.controls, dt, now, this.clock.scale);
    this.floor.update(this.cameras.main);
    this.debug.update(delta);
    this.controls.endFrame();
  }

  private togglePause(): void {
    if (this.clock.hasScale('pause')) this.clock.resume('pause');
    else this.clock.pause('pause');
    this.pauseText.setVisible(this.clock.hasScale('pause'));
  }

  private debugKeys(now: number): void {
    const p = this.player;
    if (this.controls.justDown('debugAttack')) p.trigger('attack', now);
    if (this.controls.justDown('debugDefend')) p.trigger('defend', now);
    if (this.controls.justDown('debugSkill')) p.trigger('skill', now);
    if (this.controls.justDown('debugCrit')) p.trigger('crit', now);
    if (this.controls.justDown('debugSlow')) p.speedMul = p.speedMul < 1 ? 1 : DEBUG_SLOW;
    if (this.controls.justDown('debugCharacter')) {
      const next = CHARACTERS[(CHARACTERS.indexOf(p.id) + 1) % CHARACTERS.length] as CharacterId;
      p.setCharacter(next, now);
    }
  }
}
