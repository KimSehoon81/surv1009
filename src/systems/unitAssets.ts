// 유닛 그림(캐릭터·적·NPC 시트)은 전부가 아니라 전투마다 필요한 것만 올리고, 다음 전투 전에 안 쓰는 것을 내린다.
// (전부 올리면 텍스처만 약 670MB — 휴대폰 브라우저가 버티지 못함. 2026-11-16)
import type * as Phaser from 'phaser';
import characters from '../data/characters.json';
import enemiesData from '../data/enemies.json';
import npcData from '../data/npcs.json';
import stagesData from '../data/stages.json';
import ambientData from '../data/ambient.json';
import supportData from '../data/support.json';
import titleData from '../data/title.json';
import { manifest, type SheetSpec } from '../assets/manifest';
import { closeOver, collectIds } from '../core/unitNeeds';
import { params } from '../config/params';
import { isImplemented } from '../entities/Player';
import { ensureTextures, queueAssets, releaseTextures } from './assetLoader';
import { isTouchDevice } from './touch';

const ENEMIES = enemiesData.enemies as Record<string, { looks?: string[] }>;
const NPCS = npcData.npcs as Record<string, unknown>;
const DEFS: Record<string, unknown> = { ...ENEMIES, ...NPCS };
const LOOKS = Object.values(ENEMIES).flatMap((e) => e.looks ?? []);
const KNOWN = new Set([...Object.keys(DEFS), ...LOOKS]);
const CHARS = new Set(Object.keys(characters.characters));
const STAGES = stagesData.stages as Record<string, unknown>;

/** 터치 기기는 유닛을 아틀라스 페이지(2048² = 16MB 단위) 대신 개별 시트로: 딱 필요한 만큼만 메모리에 */
const unitAtlas = (): boolean => !isTouchDevice();

/** 그림 파일이 있는 시트만(겉모습 변형·주변 생활처럼 없으면 다른 모습으로 대신하는 것) */
const drawn = (id: string): SheetSpec[] => manifest.unitSheets(id).filter((s) => s.path !== null);

/** 메뉴 화면(첫 화면 행군·출정 준비·성장 지도)과 지원 분대가 쓰는 시트: 캐릭터 전원의 걷는 모습 한 장씩. 늘 올려 둠 */
export function menuSheets(): SheetSpec[] {
  const ids = new Set([...Object.keys(characters.characters).filter(isImplemented), ...collectIds(titleData, CHARS), ...collectIds(supportData, CHARS)]);
  return [...ids].map((id) => manifest.sheet(id, 'move_slow'));
}
const permanent = new Set<string>();

/** 전투 한 판에 나오는 유닛: 주인공 + 그 지역의 적·보스·NPC(소환·겉모습 변형 포함) + 주변 생활. 디버그 모드는 전부(아무 적이나 불러낼 수 있게) */
export function battleUnitIds(stageKey: string, char: string): string[] {
  const seeds = params.debug ? new Set(KNOWN) : collectIds(STAGES[stageKey] ?? STAGES.S1, KNOWN);
  collectIds(stagesData.rules, KNOWN, seeds);
  // 적 풀의 기본 모습(E01)·NPC 틀(N01)은 늘 필요
  for (const id of ['E01', 'N01']) if (KNOWN.has(id)) seeds.add(id);
  return [char, ...closeOver(seeds, DEFS, KNOWN), ...Object.keys(ambientData.critters)];
}

/** 유닛 id → 올린 시트(전투용) */
const loaded = new Map<string, SheetSpec[]>();

/** 그 유닛의 애니메이션 제거(시트를 내리거나 새로 올릴 때: 예전 텍스처 프레임을 붙들고 있지 않게) */
function dropAnims(scene: Phaser.Scene, id: string): void {
  const all = (scene.anims as unknown as { anims: { entries: Record<string, unknown> } }).anims.entries;
  for (const key of Object.keys(all)) if (key.startsWith(`${id}_`)) scene.anims.remove(key);
}

/** 전투 preload(): 이번 판에 안 쓰는 유닛을 내리고, 필요한 유닛을 로더 큐에. 돌려준 목록을 create()에서 finishUnits에 넘김 */
export function prepareUnits(scene: Phaser.Scene, ids: readonly string[]): SheetSpec[] {
  const keep = new Set(ids);
  for (const [id, specs] of loaded) {
    if (keep.has(id)) continue;
    dropAnims(scene, id);
    const keys = specs.map((s) => s.key).filter((k) => !permanent.has(k));
    releaseTextures(scene, [...keys.map((k) => `${k}__stride`), ...keys]);
    loaded.delete(id);
  }
  const specs: SheetSpec[] = [];
  for (const id of keep) {
    if (loaded.has(id)) continue;
    // 메뉴에서 걷는 모습만으로 만든 애니메이션(대기 = 걷기 첫 프레임 등)을 지우고 전체 시트로 다시 만들게
    dropAnims(scene, id);
    const sheets = CHARS.has(id) || id in DEFS ? manifest.unitSheets(id) : drawn(id);
    loaded.set(id, sheets);
    specs.push(...sheets);
  }
  queueAssets(scene, specs, unitAtlas());
  return specs;
}

/** 전투 create(): 올라온 시트 등록(없는 그림은 자리표시자) */
export function finishUnits(scene: Phaser.Scene, specs: readonly SheetSpec[]): void {
  ensureTextures(scene, specs, unitAtlas());
}

/** 시작할 때(PreloadScene): 메뉴용 시트 */
export function queueMenuUnits(scene: Phaser.Scene): SheetSpec[] {
  const specs = menuSheets();
  for (const s of specs) permanent.add(s.key);
  queueAssets(scene, specs, unitAtlas());
  return specs;
}

/** 그래픽 갤러리(개발용)처럼 따로 올린 유닛도 전투가 내릴 수 있게 등록 */
export function trackUnits(ids: readonly string[]): void {
  for (const id of ids) if (!loaded.has(id)) loaded.set(id, manifest.unitSheets(id));
}

/** 지금 전투용으로 올라와 있는 유닛(테스트·디버그) */
export const loadedUnitIds = (): string[] => [...loaded.keys()];
export { unitAtlas };
