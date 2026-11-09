// 설정값 읽기(저장에 없으면 settings.json 기본값). 전투·HUD·입력이 이것만 본다.
import settings from '../data/settings.json';
import controls from '../data/controls.json';
import { effectiveKeys } from '../core/keymap';
import { loadProfile } from './save';

export type Prefs = typeof settings.defaults;

export function prefs(): Prefs {
  const s = loadProfile().settings as Partial<Prefs>;
  const d = settings.defaults;
  return {
    feel: typeof s.feel === 'number' ? Math.max(0, Math.min(1, s.feel)) : d.feel,
    mono: s.mono ?? d.mono,
    selectSlowmo: s.selectSlowmo ?? d.selectSlowmo,
    recommendHint: s.recommendHint ?? d.recommendHint,
    shortJudge: s.shortJudge ?? d.shortJudge,
    threatFirst: s.threatFirst ?? d.threatFirst,
    autoDiscardMinus: s.autoDiscardMinus ?? d.autoDiscardMinus,
    recruit: s.recruit ?? d.recruit,
  };
}

/** 지금 쓸 키 배치(키 재설정 반영) */
export function keyMap(): Record<string, readonly string[]> {
  return effectiveKeys(controls.keys, loadProfile().settings.keys);
}
