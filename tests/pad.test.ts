import { describe, expect, it } from 'vitest';
import controls from '../src/data/controls.json';
import { PAD_BUTTONS, createPadState, heldPadState, padMove, stepPad, type PadConfig, type PadSnapshot } from '../src/core/pad';

const CFG = controls.padConfig as PadConfig;
const BIND = controls.pad as Record<string, string[]>;
const snap = (pressed: string[] = [], axes: number[] = [0, 0, 0, 0]): PadSnapshot => ({
  buttons: PAD_BUTTONS.map((n) => (pressed.includes(n) ? 1 : 0)),
  axes,
});

describe('게임패드(PRD §3, D43)', () => {
  it('바인딩은 controls.json에 있는 액션, 이름은 알려진 버튼·스틱 방향', () => {
    const known = new Set<string>([...PAD_BUTTONS, ...['LS', 'RS'].flatMap((s) => ['Up', 'Down', 'Left', 'Right'].map((d) => s + d))]);
    for (const [a, names] of Object.entries(BIND)) {
      expect(controls.keys, a).toHaveProperty(a);
      for (const n of names) expect(known.has(n.replace(':hold', '')), `${a}:${n}`).toBe(true);
    }
  });

  it('PRD 조작 표: A 제출·B 해제·X 카드·LB RB LT RT 스킬·View 작전판·Start 정지·Y 길게 인장', () => {
    expect(BIND.cardSubmit).toContain('A');
    expect(BIND.cardClear).toContain('B');
    expect(BIND.cardToggle).toContain('X');
    expect([BIND.skillQ, BIND.skillE, BIND.skillR, BIND.skillF].map((x) => x?.[0])).toEqual(['LB', 'RB', 'LT', 'RT']);
    expect(BIND.opsBoard).toContain('View');
    expect(BIND.pause).toContain('Start');
    expect(BIND.cardSealSubmit).toContain('Y:hold');
  });

  it('누른 순간 한 번만, 누르고 있으면 held', () => {
    let s = createPadState();
    let r = stepPad(s, snap(['A']), 0, BIND, CFG);
    expect(r.pressed).toContain('cardSubmit');
    expect(r.held).toContain('cardSubmit');
    s = r.state;
    r = stepPad(s, snap(['A']), 16, BIND, CFG);
    expect(r.pressed).not.toContain('cardSubmit');
    expect(r.held).toContain('cardSubmit');
    r = stepPad(r.state, snap([]), 32, BIND, CFG);
    expect(r.held).not.toContain('cardSubmit');
  });

  it('Y 길게(holdMs) 누르면 인장 제출 한 번, 짧게는 없음', () => {
    let s = createPadState();
    const fired: number[] = [];
    for (let t = 0; t <= 1000; t += 16) {
      const r = stepPad(s, snap(['Y']), t, BIND, CFG);
      if (r.pressed.includes('cardSealSubmit')) fired.push(t);
      s = r.state;
    }
    expect(fired.length).toBe(1);
    expect(fired[0]).toBeGreaterThanOrEqual(CFG.holdMs);
    s = createPadState();
    let short = false;
    for (let t = 0; t < CFG.holdMs - 50; t += 16) {
      const r = stepPad(s, snap(['Y']), t, BIND, CFG);
      short ||= r.pressed.includes('cardSealSubmit');
      s = r.state;
    }
    expect(short).toBe(false);
  });

  it('방향은 처음 한 번 → repeatDelay 뒤부터 repeatMs마다 반복(카드 커서·메뉴)', () => {
    let s = createPadState();
    const times: number[] = [];
    for (let t = 0; t <= CFG.repeatDelayMs + CFG.repeatMs * 2 + 1; t += 10) {
      const r = stepPad(s, snap(['DRight']), t, BIND, CFG);
      if (r.pressed.includes('cardNext')) times.push(t);
      s = r.state;
    }
    const d = CFG.repeatDelayMs;
    const k = CFG.repeatMs;
    expect(times).toEqual([0, d, d + k, d + 2 * k]);
  });

  it('오른쪽 스틱 좌우도 카드 커서, 왼쪽 스틱은 이동(데드존·길이 1 이하)', () => {
    const r = stepPad(createPadState(), snap([], [0, 0, -0.9, 0]), 0, BIND, CFG);
    expect(r.pressed).toContain('cardPrev');
    expect(padMove(snap([], [0.05, 0.05]), CFG)).toEqual({ x: 0, y: 0 });
    const m = padMove(snap([], [1, 1]), CFG);
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(1);
    const half = padMove(snap([], [0.6, 0]), CFG);
    expect(half.x).toBeGreaterThan(0);
    expect(half.x).toBeLessThan(0.6);
  });

  it('새 화면은 이미 누르고 있던 버튼을 새 눌림·길게로 치지 않는다(장면 전환 연타 방지)', () => {
    let s = heldPadState(snap(['A', 'Y', 'DDown']), CFG, 0);
    let any = false;
    for (let t = 0; t <= 1000; t += 16) {
      const r = stepPad(s, snap(['A', 'Y', 'DDown']), t, BIND, CFG);
      any ||= r.pressed.includes('uiConfirm') || r.pressed.includes('cardSealSubmit') || r.pressed.includes('uiDown');
      s = r.state;
    }
    expect(any).toBe(false);
    const up = stepPad(s, snap([]), 1100, BIND, CFG);
    expect(stepPad(up.state, snap(['A']), 1200, BIND, CFG).pressed).toContain('uiConfirm');
  });
});
