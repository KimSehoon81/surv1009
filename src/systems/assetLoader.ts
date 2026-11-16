// 씬별 에셋 로딩. 파일이 있으면 Phaser 로더로, 없거나 로드 실패면 자리표시자로 같은 키를 채운다.
// 텍스처는 게임 전역(TextureManager)이라 한 번 만든 키는 다른 씬에서도 재사용된다.

import * as Phaser from 'phaser';
import type { AssetSpec } from '../assets/manifest';
import atlases from '../assets/atlases.json';
import { createFxPlaceholder, createImagePlaceholder, createSheetPlaceholder } from './placeholders';

/** 아틀라스(D40, npm run atlas): public/assets 기준 경로 → 페이지. 없으면 빈 목록이라 지금처럼 개별 로드 */
const PAGES = atlases as { key: string; png: string; json: string; files: string[] }[];
const PAGE_OF = new Map<string, (typeof PAGES)[number]>();
for (const p of PAGES) for (const f of p.files) PAGE_OF.set(f, p);
const relOf = (path: string | null): string => (path ? (path.split('assets/').pop() ?? '') : '');
const pageOf = (spec: AssetSpec) => PAGE_OF.get(relOf(spec.path));

/** 아틀라스 페이지 → 거기서 꺼내 쓰는 키들(페이지의 GL 텍스처를 같이 씀). 다 내리면 페이지도 내림 */
const pageUsers = new Map<string, Set<string>>();
/** 페이지의 GL 텍스처를 빌려 쓰는 키 → 페이지 키 */
const sharedKeys = new Map<string, string>();

/** preload()에서 호출: 실제 파일이 있는 에셋만 로더 큐에 넣는다(아틀라스에 든 것은 그 페이지를 한 번). useAtlas=false면 늘 개별 파일(메모리를 아껴야 하는 터치 기기의 유닛) */
export function queueAssets(scene: Phaser.Scene, specs: readonly AssetSpec[], useAtlas = true): void {
  const pages = new Set<(typeof PAGES)[number]>();
  for (const spec of specs) {
    if (!spec.path || scene.textures.exists(spec.key)) continue;
    const page = useAtlas ? pageOf(spec) : undefined;
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

/**
 * 아틀라스 프레임을 원래 키의 시트로 등록(그리기 묶음). 성공하면 true.
 * 페이지의 GL 텍스처를 그대로 빌려 쓴다 — Phaser의 addSpriteSheetFromAtlas는 키마다 페이지 그림 전체를 GPU에 다시 올려서
 * (2048² = 16MB × 시트 수) 메모리가 수 GB로 불어난다(2026-11-16 실측 10GB → 페이지 합계만)
 */
function fromAtlas(scene: Phaser.Scene, spec: AssetSpec): boolean {
  const page = pageOf(spec);
  if (!page || !scene.textures.exists(page.key)) return false;
  const rel = relOf(spec.path);
  const atlas = scene.textures.get(page.key);
  if (!atlas.has(rel)) return false;
  const frame = atlas.get(rel);
  const src = frame.source;
  const size = spec.kind === 'sheet' || spec.kind === 'fx' ? { frameWidth: spec.frameSize, frameHeight: spec.frameSize, endFrame: spec.frames - 1 } : { frameWidth: spec.width, frameHeight: spec.height };
  const tex = scene.textures.create(spec.key, (src.glTexture ?? src.image) as unknown as HTMLImageElement, src.width, src.height);
  if (!tex) return false;
  (Phaser.Textures.Parsers as unknown as { SpriteSheetFromAtlas(t: Phaser.Textures.Texture, f: Phaser.Textures.Frame, c: object): void }).SpriteSheetFromAtlas(tex, frame, size);
  if (src.glTexture) {
    sharedKeys.set(spec.key, page.key);
    // 그리기는 빌린 GL 텍스처로, 캔버스 합성(걸음 프레임 등)은 원본 그림으로
    for (const s of tex.source) (s as unknown as { image: unknown }).image = src.image;
  }
  let users = pageUsers.get(page.key);
  if (!users) pageUsers.set(page.key, (users = new Set()));
  users.add(spec.key);
  return true;
}

/** 텍스처 내리기(GPU 메모리 반환). 빌려 쓰던 페이지는 쓰는 키가 하나도 없을 때 같이 내림 */
export function releaseTextures(scene: Phaser.Scene, keys: readonly string[]): void {
  for (const key of keys) {
    if (!scene.textures.exists(key)) continue;
    const pageKey = sharedKeys.get(key);
    // 빌린 GL 텍스처는 지우지 않게 떼어 놓고 제거
    if (pageKey) for (const s of scene.textures.get(key).source) (s as unknown as { glTexture: unknown }).glTexture = null;
    scene.textures.remove(key);
    sharedKeys.delete(key);
    for (const [page, users] of pageUsers) {
      if (!users.delete(key) || users.size > 0) continue;
      pageUsers.delete(page);
      if (scene.textures.exists(page)) scene.textures.remove(page);
    }
  }
}

export interface EnsureResult {
  fromFile: number;
  placeholders: number;
}

/** create()에서 호출: 로드되지 않은 키를 전부 자리표시자로 채운다 */
export function ensureTextures(scene: Phaser.Scene, specs: readonly AssetSpec[], useAtlas = true): EnsureResult {
  const result: EnsureResult = { fromFile: 0, placeholders: 0 };
  for (const spec of specs) {
    if (scene.textures.exists(spec.key) || (useAtlas && fromAtlas(scene, spec))) {
      result.fromFile++;
      continue;
    }
    if (spec.path) console.warn(`[assets] load failed → placeholder: ${spec.path}`);
    if (spec.kind === 'sheet') createSheetPlaceholder(scene, spec);
    else if (spec.kind === 'fx') createFxPlaceholder(scene, spec);
    else createImagePlaceholder(scene, spec);
    result.placeholders++;
  }
  return result;
}
