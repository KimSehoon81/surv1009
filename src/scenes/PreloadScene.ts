import * as Phaser from 'phaser';
import { manifest, type AssetSpec } from '../assets/manifest';
import { ensureTextures, queueAssets } from '../systems/assetLoader';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { SceneKey } from './keys';

/** 전투 시작에 필요한 에셋 목록. 이후 Day에서 스테이지 데이터 기반으로 바뀐다 */
function battleAssets(): AssetSpec[] {
  return [...manifest.unitSheets('A01'), manifest.tile('T01'), manifest.tile('T02')];
}

export class PreloadScene extends Phaser.Scene {
  private specs: AssetSpec[] = [];

  constructor() {
    super(SceneKey.Preload);
  }

  preload(): void {
    this.specs = battleAssets();

    const barW = 320;
    const x = (LOGICAL_WIDTH - barW) / 2;
    const y = LOGICAL_HEIGHT / 2;
    const frame = this.add.rectangle(x - 2, y - 2, barW + 4, 12, 0x2a1a10).setOrigin(0);
    const bar = this.add.rectangle(x, y, 0, 8, 0x2fae9c).setOrigin(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      bar.width = barW * p;
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[assets] 로드 오류: ${file.src}`);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      frame.destroy();
      bar.destroy();
    });

    queueAssets(this, this.specs);
  }

  create(): void {
    const result = ensureTextures(this, this.specs);
    console.info(`[assets] 파일 ${result.fromFile}개, 자리표시자 ${result.placeholders}개`);
    this.scene.start(SceneKey.Battle);
  }
}
