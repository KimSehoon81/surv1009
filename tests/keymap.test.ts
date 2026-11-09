import { describe, expect, it } from 'vitest';
import controls from '../src/data/controls.json';
import settings from '../src/data/settings.json';
import { effectiveKeys, rebind } from '../src/core/keymap';

const DEF = controls.keys as Record<string, string[]>;
const GROUP = settings.keys.conflictGroup;

describe('키 재설정(PRD §11, D29)', () => {
  it('재설정 가능한 액션과 충돌 묶음은 controls.json에 있는 액션', () => {
    for (const a of [...Object.keys(settings.keys.remappable), ...GROUP]) expect(DEF, a).toHaveProperty(a);
  });

  it('바꾸면 첫 키만 교체, 대체 키는 유지', () => {
    const r = rebind(DEF, {}, 'skillQ', 'z', GROUP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(effectiveKeys(DEF, r.overrides).skillQ).toEqual(['Z']);
    const up = rebind(DEF, r.overrides, 'up', 'I', GROUP);
    expect(up.ok && effectiveKeys(DEF, up.overrides).up).toEqual(['I', 'UP']);
  });

  it('같은 전투 묶음에서 이미 쓰는 키는 거부(어느 액션인지 알려 줌)', () => {
    expect(rebind(DEF, {}, 'skillQ', 'E', GROUP)).toEqual({ ok: false, conflict: 'skillE' });
    expect(rebind(DEF, {}, 'skillQ', 'ONE', GROUP)).toMatchObject({ ok: false });
    expect(rebind(DEF, {}, 'skillQ', 'Q', GROUP).ok).toBe(true);
  });

  it('기본값 복원 = 덮어쓰기 없음', () => {
    expect(effectiveKeys(DEF, {})).toEqual(DEF);
    expect(effectiveKeys(DEF, undefined).cardSubmit).toEqual(DEF.cardSubmit);
  });

  it('기본 설정 자체에 충돌이 없다', () => {
    const seen = new Map<string, string>();
    for (const a of GROUP) {
      for (const k of DEF[a] ?? []) {
        const prev = seen.get(k);
        // 레벨업·카드 숫자키, 리롤 R과 스킬 R은 화면이 달라 기본 공유
        const shared = (x: string) => /^(levelPick|cardSelect)/.test(x) || x === 'levelReroll' || x === 'skillR';
        if (prev && !(shared(prev) && shared(a))) throw new Error(`${k}: ${prev} / ${a}`);
        seen.set(k, a);
      }
    }
  });
});
