import './i18n/boot';
import { installErrorScreen } from './systems/errors';
import * as Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from './config/display';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { BattleScene } from './scenes/BattleScene';
import { GalleryScene } from './scenes/GalleryScene';
import { HudScene } from './scenes/HudScene';
import { AudioGalleryScene } from './scenes/AudioGalleryScene';
import { MenuScene } from './scenes/MenuScene';
import { MapScene } from './scenes/MapScene';
import { PrepScene } from './scenes/PrepScene';
import { WebScene } from './scenes/WebScene';
import { SettingsScene } from './scenes/SettingsScene';
import { EndingScene } from './scenes/EndingScene';
import { CodexScene } from './scenes/CodexScene';
import { setTextResolution, textResolution } from './ui/text';
import { SceneKey } from './scenes/keys';
import { currentView, installPointerTransform, layoutView } from './systems/view';
import { installTouch, type TouchContext } from './systems/touch';

installErrorScreen();

// 글꼴이 늦게 오면 첫 화면 글자가 대체 글꼴로 굳으므로 잠깐 기다린다(최대 2.5초)
async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const all = Promise.all(['11px Galmuri11', '14px Galmuri14'].map((f) => document.fonts.load(f, String.fromCharCode(0xac00, 0x41)))).then(() => undefined);
  await Promise.race([all, new Promise<void>((r) => setTimeout(r, 2500))]).catch(() => undefined);
}
await loadFonts();
const parent = document.getElementById('game') as HTMLElement;
const startZoom = layoutView(parent).zoom;
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
  // 터치: 카드·메뉴를 누르는 손가락 + 여유(조이스틱·버튼은 DOM 조작판이 따로 받음)
  input: { keyboard: true, mouse: true, touch: true, gamepad: false, activePointers: 3 },
  scene: [BootScene, PreloadScene, MenuScene, MapScene, PrepScene, WebScene, SettingsScene, EndingScene, CodexScene, BattleScene, HudScene, GalleryScene, AudioGalleryScene],
});

/** 배율이 바뀌면 이미 있는 글자도 새 해상도로 다시 그림(1배 ↔ 2배에서 획이 빠지지 않게) */
function refreshTexts(list: Phaser.GameObjects.GameObject[]): void {
  for (const o of list) {
    if (o instanceof Phaser.GameObjects.Text) o.setResolution(textResolution());
    else if (o instanceof Phaser.GameObjects.Container) refreshTexts(o.list);
  }
}
function relayout(): void {
  const z = layoutView(parent).zoom;
  game.scale.setZoom(z);
  if (setTextResolution(z)) for (const s of game.scene.getScenes(false)) refreshTexts(s.children.list);
}
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => window.setTimeout(relayout, 250));
window.visualViewport?.addEventListener('resize', relayout);
installPointerTransform(game);

// 터치 조작판(모바일): 전투가 흐르는 중이면 조이스틱·스킬, 멈춘 창·메뉴에서는 방향·확인·뒤로
function touchContext(): TouchContext {
  const sm = game.scene;
  if (sm.isActive(SceneKey.Boot) || sm.isActive(SceneKey.Preload)) return { mode: 'none' };
  if (sm.isActive(SceneKey.Battle)) {
    const b = sm.getScene(SceneKey.Battle) as BattleScene;
    return b.touchPlay ? { mode: 'battle', skills: b.touchSkills } : { mode: 'menu', again: b.progression.isOpen || Boolean(b.result) };
  }
  return { mode: 'menu', again: sm.isActive(SceneKey.Web), adjust: sm.isActive(SceneKey.Prep) || sm.isActive(SceneKey.Settings) };
}
const syncTouch = installTouch(parent, currentView, touchContext);
game.events.on(Phaser.Core.Events.POST_STEP, syncTouch);

// 개발·자동 테스트(Playwright)에서 상태 확인용
declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}
window.__game = game;
