import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import propsData from '../data/props.json';
import sfxData from '../data/sfx.json';
import { resetProfile } from '../systems/save';
import feelData from '../data/feel.json';
import weaponData from '../data/weapons.json';
import upgradesData from '../data/upgrades.json';
import { manifest, type AssetSpec } from '../assets/manifest';
import { ensureTextures, queueAssets } from '../systems/assetLoader';
import { queueMenuUnits, trackUnits, unitAtlas } from '../systems/unitAssets';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { params } from '../config/params';
import { SceneKey } from './keys';
import { galleryUnitIds } from './GalleryScene';
import cardsData from '../data/cards.json';
import { cardAssetSpecs } from '../ui/cardFace';
import { CUES } from '../systems/timeline';
import skillsData from '../data/skills.json';

/** 모든 스테이지 바닥 타일(floor.json) */
function floorTiles(): AssetSpec[] {
  const cfgs = Object.entries(floorData).filter(([k]) => !k.startsWith('$')).map(([, v]) => v as { base: string; patch: string });
  return [...new Set(cfgs.flatMap((c) => [c.base, c.patch]))].map((t) => manifest.tile(t));
}

/** 어느 화면·전투에서나 쓰는 에셋(UI·이펙트·카드·소품·바닥). 유닛 시트는 전투마다 필요한 것만 따로(systems/unitAssets) */
function commonAssets(): AssetSpec[] {
  // UI 그림: 무기 투사체, 경험치 별, 레벨업 업그레이드 아이콘(데이터가 참조하는 것 전부)
  const weaponSprites = Object.values(weaponData.weapons).flatMap((w) => ('sprite' in w ? [w.sprite] : []));
  const upgradeIcons = [...upgradesData.upgrades, ...upgradesData.fallbacks].map((u) => u.icon);
  const ui = [...new Set(['star_xp', 'icon_upgrade_reroll', 'flag_ally', 'supply_crate', ...weaponSprites, ...upgradeIcons])].map((n) => manifest.image('ui', n, 32, 32));
  // 이펙트: 무기·타격감 프리셋·총구 섬광이 참조하는 시트 전부
  const named = (o: object) => Object.values(o as Record<string, { fx?: string }>).map((v) => v.fx);
  const sheets = Object.values(feelData.particles.kinds as Record<string, { sheet?: string }>).map((k) => k.sheet);
  // 연출 큐(cues.json)의 시트·비행체·설치물
  const cueSheets = Object.values(CUES).flatMap((c) => [
    c.fx,
    c.fly?.sprite,
    c.prop?.sheet,
    c.dash?.sprite,
    c.fall?.sheet,
    c.gunner ? 'support_volley' : undefined,
    c.mine ? 'mines' : undefined,
  ]);
  const fxNames = new Set([...named(weaponData.weapons), ...named(feelData.presets), feelData.muzzle.fx, ...sheets, ...cueSheets]);
  const fx = [...fxNames].filter((n): n is string => typeof n === 'string').map((n) => manifest.fx(n));
  const skillIcons = Object.values(skillsData.skills).map((sk) => manifest.image('skills', sk.icon, 32, 32));
  const cards = cardAssetSpecs(Object.keys(cardsData.cards), Object.keys(cardsData.tags));
  // 배경 소품(props.json 전 스테이지)
  const propNames = [...new Set(Object.values(propsData.stages as Record<string, { kinds: { sprite: string }[] }>).flatMap((s) => s.kinds.map((k) => k.sprite)))];
  const props = propNames.map((n) => manifest.prop(n));
  // 단일 그림(첫 화면 배경·코드 그림 대체, assets.json sprites): 파일이 있는 것만
  const sprites = Object.keys((manifest.spec as unknown as { sprites?: Record<string, unknown> }).sprites ?? {})
    .filter((n) => !n.startsWith('$'))
    .map((n) => manifest.sprite(n))
    .filter((s) => s.path !== null);
  return [...sprites, ...ui, ...fx, ...skillIcons, ...cards, ...props, ...floorTiles()];
}

export class PreloadScene extends Phaser.Scene {
  private specs: AssetSpec[] = [];
  private unitSpecs: AssetSpec[] = [];

  constructor() {
    super(SceneKey.Preload);
  }

  preload(): void {
    this.specs = params.audioGallery ? [] : params.gallery ? galleryUnitIds().flatMap((id) => manifest.unitSheets(id)) : commonAssets();
    if (params.gallery) trackUnits(galleryUnitIds());
    else if (!params.audioGallery) this.unitSpecs = queueMenuUnits(this);
    // 소리 파일(선택): 있으면 합성음·무음 대신. 디코딩된 버퍼는 cache.audio에 들어가 AudioSystem이 가져간다
    for (const name of [...Object.keys(sfxData.sources), ...Object.keys(sfxData.bgm.tracks)]) {
      for (const f of manifest.audio(name)) if (!this.cache.audio.exists(f.key)) this.load.audio(f.key, f.urls);
    }

    const barW = 320;
    const x = (LOGICAL_WIDTH - barW) / 2;
    const y = LOGICAL_HEIGHT / 2;
    const frame = this.add.rectangle(x - 2, y - 2, barW + 4, 12, 0x2a1a10).setOrigin(0);
    const bar = this.add.rectangle(x, y, 0, 8, 0x2fae9c).setOrigin(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      bar.width = barW * p;
    });
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[assets] load error: ${file.src}`);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      frame.destroy();
      bar.destroy();
    });

    queueAssets(this, this.specs);
  }

  create(): void {
    const result = ensureTextures(this, this.specs);
    ensureTextures(this, this.unitSpecs, unitAtlas());
    console.info(`[assets] files ${result.fromFile}, placeholders ${result.placeholders}`);
    if (params.reset) resetProfile();
    this.scene.start(params.audioGallery ? SceneKey.AudioGallery : params.gallery ? SceneKey.Gallery : params.quickBattle ? SceneKey.Battle : SceneKey.Menu);
  }
}
