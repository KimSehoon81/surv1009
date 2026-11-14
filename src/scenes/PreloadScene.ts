import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import characters from '../data/characters.json';
import stagesData from '../data/stages.json';
import enemiesData from '../data/enemies.json';
import npcData from '../data/npcs.json';
import propsData from '../data/props.json';
import sfxData from '../data/sfx.json';
import { resetProfile } from '../systems/save';
import feelData from '../data/feel.json';
import weaponData from '../data/weapons.json';
import upgradesData from '../data/upgrades.json';
import { manifest, type AssetSpec } from '../assets/manifest';
import ambientData from '../data/ambient.json';
import { ensureTextures, queueAssets } from '../systems/assetLoader';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { params } from '../config/params';
import { SceneKey } from './keys';
import { galleryUnitIds } from './GalleryScene';
import cardsData from '../data/cards.json';
import { cardAssetSpecs } from '../ui/cardFace';
import { CUES } from '../systems/timeline';
import { isImplemented } from '../entities/Player';
import skillsData from '../data/skills.json';

/** 모든 스테이지 바닥 타일(floor.json) */
function floorTiles(): AssetSpec[] {
  const cfgs = Object.entries(floorData).filter(([k]) => !k.startsWith('$')).map(([, v]) => v as { base: string; patch: string });
  return [...new Set(cfgs.flatMap((c) => [c.base, c.patch]))].map((t) => manifest.tile(t));
}

/** 전투 시작에 필요한 에셋: 선택 가능한 캐릭터 전원 + 스테이지에 나오는 적 + 바닥 */
function battleAssets(): AssetSpec[] {
  // 스테이지의 모든 적(구간 스폰·엘리트·보스)
  const st = stagesData.stages.S1;
  // 정의된 적 전부(어느 스테이지·디버그 묶음에서든 나올 수 있음, 없는 그림은 자리표시자) + 스테이지 NPC
  const enemyIds = [...new Set([...Object.keys(enemiesData.enemies), ...st.npcs, ...Object.keys(npcData.npcs)])];
  // 구현된 캐릭터만(미구현 골격은 시트 없음)
  const units = [...Object.keys(characters.characters).filter(isImplemented), ...enemyIds].flatMap((id) => manifest.unitSheets(id));
  // 적 겉모습 변형(looks)·주변 생활(소·호랑이·개·주민): 그림 파일이 있는 시트만(없으면 원본 모습·코드 도트를 씀)
  const looks = Object.values(enemiesData.enemies).flatMap((e) => (e as { looks?: string[] }).looks ?? []);
  const extras = [...looks, ...Object.keys(ambientData.critters)].flatMap((id) => manifest.unitSheets(id)).filter((s) => s.path !== null);
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
  return [...units, ...extras, ...ui, ...fx, ...skillIcons, ...cards, ...props, ...floorTiles()];
}

export class PreloadScene extends Phaser.Scene {
  private specs: AssetSpec[] = [];

  constructor() {
    super(SceneKey.Preload);
  }

  preload(): void {
    this.specs = params.audioGallery ? [] : params.gallery ? galleryUnitIds().flatMap((id) => manifest.unitSheets(id)) : battleAssets();
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
    console.info(`[assets] files ${result.fromFile}, placeholders ${result.placeholders}`);
    if (params.reset) resetProfile();
    this.scene.start(params.audioGallery ? SceneKey.AudioGallery : params.gallery ? SceneKey.Gallery : params.quickBattle ? SceneKey.Battle : SceneKey.Menu);
  }
}
