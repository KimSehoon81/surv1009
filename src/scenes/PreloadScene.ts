import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import characters from '../data/characters.json';
import spawnData from '../data/spawn.json';
import feelData from '../data/feel.json';
import weaponData from '../data/weapons.json';
import { manifest, type AssetSpec } from '../assets/manifest';
import { ensureTextures, queueAssets } from '../systems/assetLoader';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { params } from '../config/params';
import { SceneKey } from './keys';
import { galleryUnitIds } from './GalleryScene';

/** 전투 시작에 필요한 에셋: 선택 가능한 캐릭터 전원 + 스테이지에 나오는 적 + 바닥 */
function battleAssets(): AssetSpec[] {
  const enemyIds = [...new Set(spawnData.S1.spawns.map((s) => s.enemy))];
  const units = [...Object.keys(characters.characters), ...enemyIds].flatMap((id) => manifest.unitSheets(id));
  const ui = ['bullet', 'star_xp', 'icon_upgrade_weapon_grenade'].map((n) => manifest.image('ui', n, 32, 32));
  // 이펙트: 무기·타격감 프리셋·총구 섬광이 참조하는 시트 전부
  const named = (o: object) => Object.values(o as Record<string, { fx?: string }>).map((v) => v.fx);
  const fxNames = new Set([...named(weaponData.weapons), ...named(feelData.presets), feelData.muzzle.fx]);
  const fx = [...fxNames].filter((n): n is string => typeof n === 'string').map((n) => manifest.fx(n));
  return [...units, ...ui, ...fx, manifest.tile(floorData.S1.base), manifest.tile(floorData.S1.patch)];
}

export class PreloadScene extends Phaser.Scene {
  private specs: AssetSpec[] = [];

  constructor() {
    super(SceneKey.Preload);
  }

  preload(): void {
    this.specs = params.gallery ? galleryUnitIds().flatMap((id) => manifest.unitSheets(id)) : battleAssets();

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
    this.scene.start(params.gallery ? SceneKey.Gallery : SceneKey.Battle);
  }
}
