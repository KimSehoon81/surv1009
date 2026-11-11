// 씬별 에셋 로딩. 파일이 있으면 Phaser 로더로, 없거나 로드 실패면 자리표시자로 같은 키를 채운다.
// 텍스처는 게임 전역(TextureManager)이라 한 번 만든 키는 다른 씬에서도 재사용된다.

import type * as Phaser from 'phaser';
import type { AssetSpec } from '../assets/manifest';
import atlases from '../assets/atlases.json';
import { createFxPlaceholder, createImagePlaceholder, createSheetPlaceholder } from './placeholders';

/** 아틀라스(D40, npm run atlas): public/assets 기준 경로 → 페이지. 없으면 빈 목록이라 지금처럼 개별 로드 */
const PAGES = atlases as { key: string; png: string; json: string; files: string[] }[];
const PAGE_OF = new Map<string, (typeof PAGES)[number]>();
for (const p of PAGES) for (const f of p.files) PAGE_OF.set(f, p);
const relOf = (path: string | null): string => (path ? (path.split('assets/').pop() ?? '') : '');
const pageOf = (spec: AssetSpec) => PAGE_OF.get(relOf(spec.path));

/** preload()에서 호출: 실제 파일이 있는 에셋만 로더 큐에 넣는다(아틀라스에 든 것은 그 페이지를 한 번) */
export function queueAssets(scene: Phaser.Scene, specs: readonly AssetSpec[]): void {
  const pages = new Set<(typeof PAGES)[number]>();
  for (const spec of specs) {
    if (!spec.path || scene.textures.exists(spec.key)) continue;
    const page = pageOf(spec);
    if (page) {
      pages.add(page);
      continue;
    }
    if (spec.kind === 'sheet' || spec.kind === 'fx') {
      scene.load.spritesheet(spec.key, spec.path, {
        frameWidth: spec.frameSize,
        frameHeight: spec.frameSize,
        endFrame: spec.frames - 1,
      });
    } else {
      scene.load.image(spec.key, spec.path);
    }
  }
  for (const p of pages) if (!scene.textures.exists(p.key)) scene.load.atlas(p.key, p.png, p.json);
}

/** 아틀라스 프레임을 원래 키의 시트(같은 원본 이미지 공유 → 그리기 묶음)로 등록. 성공하면 true */
function fromAtlas(scene: Phaser.Scene, spec: AssetSpec): boolean {
  const page = pageOf(spec);
  if (!page || !scene.textures.exists(page.key)) return false;
  const rel = relOf(spec.path);
  const size = spec.kind === 'sheet' || spec.kind === 'fx' ? { frameWidth: spec.frameSize, frameHeight: spec.frameSize, endFrame: spec.frames - 1 } : { frameWidth: spec.width, frameHeight: spec.height };
  return Boolean(scene.textures.addSpriteSheetFromAtlas(spec.key, { atlas: page.key, frame: rel, ...size }));
}

export interface EnsureResult {
  fromFile: number;
  placeholders: number;
}

/** create()에서 호출: 로드되지 않은 키를 전부 자리표시자로 채운다 */
export function ensureTextures(scene: Phaser.Scene, specs: readonly AssetSpec[]): EnsureResult {
  const result: EnsureResult = { fromFile: 0, placeholders: 0 };
  for (const spec of specs) {
    if (scene.textures.exists(spec.key) || fromAtlas(scene, spec)) {
      result.fromFile++;
      continue;
    }
    if (spec.path) console.warn(`[assets] 로드 실패 → 자리표시자 사용: ${spec.path}`);
    if (spec.kind === 'sheet') createSheetPlaceholder(scene, spec);
    else if (spec.kind === 'fx') createFxPlaceholder(scene, spec);
    else createImagePlaceholder(scene, spec);
    result.placeholders++;
  }
  return result;
}
