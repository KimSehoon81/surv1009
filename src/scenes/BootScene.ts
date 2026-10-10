import * as Phaser from 'phaser';
import { SceneKey } from './keys';

/** 최소 초기화만 하고 Preload로 넘긴다(이후 설정·세이브 로드가 여기 들어온다) */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    this.scene.start(SceneKey.Preload);
  }
}
