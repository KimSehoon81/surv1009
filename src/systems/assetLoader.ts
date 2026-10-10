// 씬별 에셋 로딩. 파일이 있으면 Phaser 로더로, 없거나 로드 실패면 자리표시자로 같은 키를 채운다.
// 텍스처는 게임 전역(TextureManager)이라 한 번 만든 키는 다른 씬에서도 재사용된다.

import type * as Phaser from 'phaser';
import type { AssetSpec } from '../assets/manifest';
import { createFxPlaceholder, createImagePlaceholder, createSheetPlaceholder } from './placeholders';

/** preload()에서 호출: 실제 파일이 있는 에셋만 로더 큐에 넣는다 */
export function queueAssets(scene: Phaser.Scene, specs: readonly AssetSpec[]): void {
  for (const spec of specs) {
    if (!spec.path || scene.textures.exists(spec.key)) continue;
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
}

export interface EnsureResult {
  fromFile: number;
  placeholders: number;
}

/** create()에서 호출: 로드되지 않은 키를 전부 자리표시자로 채운다 */
export function ensureTextures(scene: Phaser.Scene, specs: readonly AssetSpec[]): EnsureResult {
  const result: EnsureResult = { fromFile: 0, placeholders: 0 };
  for (const spec of specs) {
    if (scene.textures.exists(spec.key)) {
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
