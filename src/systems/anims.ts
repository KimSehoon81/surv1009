import type * as Phaser from 'phaser';
import { manifest, type Faction, type SheetSpec } from '../assets/manifest';
import animations from '../data/animations.json';
import type { AnimRules } from '../core/animState';
import { buildStride, strideFps, wantsStride } from './stride';

export function animRules(faction: Faction): AnimRules {
  return animations[faction] as AnimRules;
}

export interface UnitAnims {
  rules: AnimRules;
  /** 동작 → 애니메이션 키 */
  keys: Record<string, string>;
  /** 동작 → 프레임 수 */
  frames: Record<string, number>;
}

/**
 * 유닛 한 명의 모든 동작 애니메이션을 등록한다(이미 있으면 재사용).
 * 동작 목록·프레임 수는 assets.json, 재생 속도·반복은 animations.json에서 온다.
 * 대기(idle) 시트가 없는 아군은 move_slow 첫 프레임을 정지 화면으로 쓴다.
 */
export function registerUnitAnims(scene: Phaser.Scene, id: string): UnitAnims {
  const faction = manifest.factionOf(id);
  const rules = animRules(faction);
  const keys: Record<string, string> = {};
  const frames: Record<string, number> = {};
  const sheets = manifest.unitSheets(id);
  const add = (action: string, sheet: SheetSpec, frameList: number[], loop: boolean, fps: number) => {
    const key = `${id}_${action}`;
    if (!scene.anims.exists(key)) {
      scene.anims.create({
        key,
        frames: frameList.map((frame) => ({ key: sheet.key, frame })),
        frameRate: fps,
        repeat: loop ? -1 : 0,
      });
    }
    keys[action] = key;
    frames[action] = frameList.length;
  };
  // 새로 그린 이동 시트(walk·run)가 있으면 예전 이동 동작 대신 그것을 재생(aliases), 그 동작의 걸음 합성은 건너뜀
  const aliases = (animations as { aliases?: Partial<Record<Faction, Record<string, string>>> }).aliases?.[faction] ?? {};
  const drawn = new Set(sheets.filter((s) => s.path !== null).map((s) => s.action));
  for (const sheet of sheets) {
    const rule = rules.actions[sheet.action];
    if (!rule) continue;
    const alt = aliases[sheet.action];
    // 이동은 발이 바뀌어 보이게 걸음 프레임으로(그림 파일이 있을 때만)
    const st = wantsStride(sheet) && !(alt && drawn.has(alt)) ? buildStride(scene, sheet) : null;
    if (st) add(sheet.action, { ...sheet, key: st.key }, Array.from({ length: st.frames }, (_, i) => i), rule.loop, strideFps(sheet.action, rule.fps));
    else add(sheet.action, sheet, Array.from({ length: sheet.frames }, (_, i) => i), rule.loop, rule.fps);
  }
  for (const [action, to] of Object.entries(aliases)) {
    const k = keys[to];
    if (k && drawn.has(to)) {
      keys[action] = k;
      frames[action] = frames[to] ?? frames[action] ?? 1;
    }
  }
  const idle = rules.locomotion.idle;
  if (!keys[idle]) {
    const fallback = sheets.find((s) => s.action === rules.locomotion.slow) ?? sheets[0];
    if (fallback) add(idle, fallback, [0], true, 1);
  }
  return { rules, keys, frames };
}
