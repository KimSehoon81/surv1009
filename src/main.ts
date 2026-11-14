import './i18n/boot';
import { installErrorScreen } from './systems/errors';
import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, computeZoom } from './config/display';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { BattleScene } from './scenes/BattleScene';
import { GalleryScene } from './scenes/GalleryScene';
import { HudScene } from './scenes/HudScene';
import { AudioGalleryScene } from './scenes/AudioGalleryScene';
import { MenuScene } from './scenes/MenuScene';
import { MapScene } from './scenes/MapScene';
import { PrepScene } from './scenes/PrepScene';
import { SettingsScene } from './scenes/SettingsScene';
import { EndingScene } from './scenes/EndingScene';
import { CodexScene } from './scenes/CodexScene';
import { setTextResolution, textResolution } from './ui/text';

installErrorScreen();

// 글꼴이 늦게 오면 첫 화면 글자가 대체 글꼴로 굳으므로 잠깐 기다린다(최대 2.5초)
async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const all = Promise.all(['11px Galmuri11', '14px Galmuri14'].map((f) => document.fonts.load(f, String.fromCharCode(0xac00, 0x41)))).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, 2500))]).catch(() => undefined);
}
await loadFonts();
const startZoom = computeZoom(window.innerWidth, window.innerHeight);
setTextResolution(startZoom);

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
    zoom: startZoom,
  },
  input: { keyboard: true, mouse: true, gamepad: false },
  scene: [BootScene, PreloadScene, MenuScene, MapScene, PrepScene, SettingsScene, EndingScene, CodexScene, BattleScene, HudScene, GalleryScene, AudioGalleryScene],
});

/** 배율이 바뀌면 이미 있는 글자도 새 해상도로 다시 그림(1배 ↔ 2배에서 획이 빠지지 않게) */
function refreshTexts(list: Phaser.GameObjects.GameObject[]): void {
  for (const o of list) {
    if (o instanceof Phaser.GameObjects.Text) o.setResolution(textResolution());
    else if (o instanceof Phaser.GameObjects.Container) refreshTexts(o.list);
  }
}
window.addEventListener('resize', () => {
  const z = computeZoom(window.innerWidth, window.innerHeight);
  game.scale.setZoom(z);
  if (setTextResolution(z)) for (const s of game.scene.getScenes(false)) refreshTexts(s.children.list);
});

// 개발·자동 테스트(Playwright)에서 상태 확인용
declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}
window.__game = game;
