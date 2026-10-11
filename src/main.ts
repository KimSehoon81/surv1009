import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, computeZoom } from './config/display';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { BattleScene } from './scenes/BattleScene';
import { GalleryScene } from './scenes/GalleryScene';
import { HudScene } from './scenes/HudScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1d1611',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.NONE,
    width: LOGICAL_WIDTH,
    height: LOGICAL_HEIGHT,
    zoom: computeZoom(window.innerWidth, window.innerHeight),
  },
  input: { keyboard: true, mouse: true, gamepad: false },
  scene: [BootScene, PreloadScene, BattleScene, HudScene, GalleryScene],
});

window.addEventListener('resize', () => {
  game.scale.setZoom(computeZoom(window.innerWidth, window.innerHeight));
});

// 개발·자동 테스트(Playwright)에서 상태 확인용
declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}
window.__game = game;
