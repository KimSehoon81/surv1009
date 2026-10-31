import * as Phaser from 'phaser';
import stagesData from '../data/stages.json';
import { LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { uiText } from '../ui/text';
import type { BattlePayload, MapPayload, PrepPayload } from '../types/scenes';
import { SceneKey } from './keys';

/** 출정 준비(D17: 빈 화면 — 캐릭터·덱·고급 스킬·스타팅 포인트는 D18) */
export class PrepScene extends Phaser.Scene {
  private controls!: InputMap;
  private payload!: PrepPayload;

  constructor() {
    super(SceneKey.Prep);
  }

  init(data: PrepPayload): void {
    this.payload = data;
  }

  create(): void {
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    const st = (stagesData.stages as Record<string, { name: string; region: string }>)[this.payload.stage];
    const cx = LOGICAL_WIDTH / 2;
    this.add.text(cx, 120, `출정 준비 — ${st?.region ?? ''} ${st?.name ?? this.payload.stage}`, uiText(22, '#ffe14d')).setOrigin(0.5);
    this.add.text(cx, 200, '캐릭터·덱·고급 스킬 장착·스타팅 포인트는 다음 단계에서 이 화면에 들어옵니다', uiText(13, '#b0a890')).setOrigin(0.5);
    this.add.text(cx, 300, 'Enter 출정 · Esc 작전지도', uiText(18)).setOrigin(0.5);
  }

  override update(): void {
    if (this.controls.justDown('uiConfirm')) {
      const payload: BattlePayload = { stage: this.payload.stage, char: 'A01' };
      this.scene.start(SceneKey.Battle, payload);
    } else if (this.controls.justDown('uiBack')) {
      const payload: MapPayload = { focus: this.payload.stage };
      this.scene.start(SceneKey.Map, payload);
    }
    this.controls.endFrame();
  }
}
