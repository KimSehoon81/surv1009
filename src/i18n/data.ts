import achievements from '../data/achievements.json';
import cards from '../data/cards.json';
import characters from '../data/characters.json';
import combos from '../data/combos.json';
import disruptions from '../data/disruptions.json';
import ending from '../data/ending.json';
import enemies from '../data/enemies.json';
import guide from '../data/guide.json';
import map from '../data/map.json';
import meta from '../data/meta.json';
import npcs from '../data/npcs.json';
import settings from '../data/settings.json';
import shop from '../data/shop.json';
import skills from '../data/skills.json';
import stages from '../data/stages.json';
import upgrades from '../data/upgrades.json';
import weapons from '../data/weapons.json';
import overlays from './data.json';
import type { Locale } from './index';

/**
 * 데이터 JSON의 화면 문자열 번역(D42). data.json의 [언어][파일][점 경로] = 번역문.
 * 가져온 JSON 객체를 그 자리에서 바꾸므로 모든 사용처가 그대로 번역본을 본다(없는 경로는 한국어 원문 유지).
 * 모듈 수준에서 이름표를 미리 만드는 곳이 있어, 언어는 다른 모듈보다 먼저(i18n/boot) 정하고 바꿀 때는 다시 불러온다.
 */
export const DATA_FILES: Record<string, unknown> = { achievements, cards, characters, combos, disruptions, ending, enemies, guide, map, meta, npcs, settings, shop, skills, stages, upgrades, weapons };
type Node = Record<string, unknown> | unknown[];
const originals = new Map<string, { parent: Node; key: string; text: string }>();

/** 경로의 부모 객체와 마지막 키. 없으면 null */
export function resolvePath(root: unknown, path: string): { parent: Node; key: string } | null {
  const parts = path.split('.');
  let cur: unknown = root;
  for (const p of parts.slice(0, -1)) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  const key = parts[parts.length - 1] ?? '';
  return cur !== null && typeof cur === 'object' && typeof (cur as Record<string, unknown>)[key] === 'string' ? { parent: cur as Node, key } : null;
}

/** 원문으로 되돌린 뒤 해당 언어 번역을 덮어씀. 덮어쓴 개수 */
export function applyDataLocale(locale: Locale): number {
  for (const { parent, key, text } of originals.values()) (parent as Record<string, unknown>)[key] = text;
  originals.clear();
  const table = (overlays as Record<string, Record<string, Record<string, string>>>)[locale];
  if (!table) return 0;
  let n = 0;
  for (const [file, entries] of Object.entries(table)) {
    for (const [path, text] of Object.entries(entries)) {
      const r = resolvePath(DATA_FILES[file], path);
      if (!r) continue;
      const rec = r.parent as Record<string, unknown>;
      originals.set(`${file}:${path}`, { parent: r.parent, key: r.key, text: rec[r.key] as string });
      rec[r.key] = text;
      n++;
    }
  }
  return n;
}
