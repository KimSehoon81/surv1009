// 에셋 키·경로·규격 정의. 실제 파일 존재 여부는 tools/gen-asset-list.mjs가 만든 available.json으로 판단하고,
// 없는 파일은 path: null → 로더가 같은 키·같은 프레임 구조의 자리표시자를 만든다.
// 그래서 사용자가 PNG를 넣으면 코드 수정 없이 교체된다. Phaser 의존 없음(테스트 가능).

import spec from '../data/assets.json';
import availableList from './available.json';

export type Faction = 'ally' | 'enemy' | 'npc';

export interface SheetSpec {
  kind: 'sheet';
  key: string;
  id: string;
  action: string;
  faction: Faction;
  /** public 기준 상대 경로. null이면 자리표시자 */
  path: string | null;
  frameSize: number;
  frames: number;
  cols: number;
  rows: number;
  large: boolean;
}

export type ImageCategory = 'tile' | 'card' | 'image';

export interface ImageSpec {
  kind: 'image';
  key: string;
  category: ImageCategory;
  label: string;
  path: string | null;
  width: number;
  height: number;
}

export type AssetSpec = SheetSpec | ImageSpec;

const UNIT_ID = /^[AEN]\d{2}$/;
const ASSET_ROOT = 'assets/';

export function createManifest(available: readonly string[]) {
  const files = new Set(available);
  const resolve = (relPath: string): string | null =>
    files.has(relPath) ? ASSET_ROOT + relPath : null;

  const factionOf = (id: string): Faction => {
    if (!UNIT_ID.test(id)) throw new Error(`manifest: 잘못된 유닛 ID "${id}" (예: A01, E05, N02)`);
    return spec.idPrefix[id[0] as keyof typeof spec.idPrefix] as Faction;
  };

  const sheetKey = (id: string, action: string): string => `${id}_${action}`;

  const sheet = (id: string, action: string): SheetSpec => {
    const faction = factionOf(id);
    const folder = spec.folders[faction];
    // 대형(200×200 프레임) 시트가 있으면 우선
    const largePath = resolve(`${folder}/${id}_${action}_L.png`);
    const normalPath = largePath ? null : resolve(`${folder}/${id}_${action}.png`);
    const large = largePath !== null;
    return {
      kind: 'sheet',
      key: sheetKey(id, action),
      id,
      action,
      faction,
      path: largePath ?? normalPath,
      frameSize: large ? spec.sheet.frameLarge : spec.sheet.frame,
      frames: spec.sheet.frames,
      cols: spec.sheet.cols,
      rows: spec.sheet.rows,
      large,
    };
  };

  /** 유닛 하나의 전체 동작 시트. 선택 동작(예: 아군 idle)은 파일이 있을 때만 포함 */
  const unitSheets = (id: string): SheetSpec[] => {
    const faction = factionOf(id);
    const required = spec.actions[faction].map((action) => sheet(id, action));
    const optional = spec.optionalActions[faction]
      .map((action) => sheet(id, action))
      .filter((s) => s.path !== null);
    return [...required, ...optional];
  };

  const tile = (id: string): ImageSpec => ({
    kind: 'image',
    key: `tile_${id}`,
    category: 'tile',
    label: id,
    path: resolve(`${spec.tile.folder}/${id}.png`),
    width: spec.tile.size,
    height: spec.tile.size,
  });

  const card = (id: string): ImageSpec => ({
    kind: 'image',
    key: `card_${id}`,
    category: 'card',
    label: id,
    path: resolve(`${spec.card.folder}/${id}.png`),
    width: spec.card.width,
    height: spec.card.height,
  });

  /** 그 밖의 단일 이미지(이펙트·UI·지도 등). 크기는 자리표시자용 */
  const image = (folder: string, name: string, width: number, height: number): ImageSpec => ({
    kind: 'image',
    key: `${folder}_${name}`,
    category: 'image',
    label: name,
    path: resolve(`${folder}/${name}.png`),
    width,
    height,
  });

  return {
    has: (relPath: string) => files.has(relPath),
    count: () => files.size,
    factionOf,
    sheetKey,
    sheet,
    unitSheets,
    tile,
    card,
    image,
    anchor: spec.anchor,
  };
}

export type Manifest = ReturnType<typeof createManifest>;

export const manifest: Manifest = createManifest(availableList as string[]);
