import { describe, expect, it } from 'vitest';
import feel from '../src/data/feel.json';
import {
  Combo,
  createKnockback,
  fadeAlpha,
  framesToMs,
  numberAnim,
  parseColor,
  punchCurve,
  shakeIntensity,
  startKnockback,
  stepKnockback,
} from '../src/core/feel';
import { CappedPool } from '../src/core/pool';
import { Depth, LAYER_ORDER } from '../src/config/depth';

type Preset = Record<string, number | string | boolean | undefined>;
const presets = feel.presets as Record<string, Preset>;

describe('PRD §4.4 프리셋 수치', () => {
  it('히트스톱 2/5/10프레임, 대형 처치 슬로모 0.3배 0.5초', () => {
    expect(presets.normal?.hitstopFrames).toBe(2);
    expect(presets.crit?.hitstopFrames).toBe(5);
    expect(presets.kill_big?.hitstopFrames).toBe(10);
    expect(presets.kill_big?.slowmoScale).toBe(0.3);
    expect(presets.kill_big?.slowmoMs).toBe(500);
  });

  it('흔들림 1px/0.08초, 3px/0.15초, 6px/0.4초', () => {
    expect([presets.normal?.shakePx, presets.normal?.shakeMs]).toEqual([1, 80]);
    expect([presets.crit?.shakePx, presets.crit?.shakeMs]).toEqual([3, 150]);
    expect([presets.kill_big?.shakePx, presets.kill_big?.shakeMs]).toEqual([6, 400]);
  });

  it('점멸 흰 2프레임·황 3프레임·전체 화면 4프레임, 넉백 4/10px, 스파크 4/10, 줌 2%/4%', () => {
    expect([presets.normal?.flashColor, presets.normal?.flashFrames]).toEqual(['#ffffff', 2]);
    expect(presets.crit?.flashFrames).toBe(3);
    expect(parseColor(String(presets.crit?.flashColor)) >> 16).toBeGreaterThan(0xe0); // 황색
    expect(presets.kill_big?.screenFlashFrames).toBe(4);
    expect([presets.normal?.knockbackPx, presets.crit?.knockbackPx]).toEqual([4, 10]);
    expect([presets.normal?.sparks, presets.crit?.sparks]).toEqual([4, 10]);
    expect(presets.normal?.zoomPunch ?? 0).toBe(0);
    expect([presets.crit?.zoomPunch, presets.kill_big?.zoomPunch]).toEqual([0.02, 0.04]);
    expect(feel.numbers.styles.crit.scale).toBe(1.6);
  });

  it('성능 가드: 데미지 숫자 40, 입자 300', () => {
    expect(feel.numbers.cap).toBe(40);
    expect(feel.particles.cap).toBe(300);
  });

  it('프리셋이 참조하는 숫자 스타일·처치 프리셋·이펙트 속도가 모두 정의돼 있다', () => {
    const styles = Object.keys(feel.numbers.styles);
    for (const [name, p] of Object.entries(presets)) {
      if (p.number !== undefined) expect(styles, name).toContain(p.number);
      if (p.fx !== undefined) expect(Object.keys(feel.fxFps), name).toContain(p.fx);
    }
    for (const target of Object.values(feel.killPresetByTier)) expect(Object.keys(presets)).toContain(target);
    for (const kind of ['spark', 'smoke', 'debris', 'crater', 'casing']) expect(Object.keys(feel.particles.kinds)).toContain(kind);
    for (const k of Object.values(feel.particles.kinds)) expect(Object.keys(Depth)).toContain(k.depth);
  });
});

describe('넉백', () => {
  it('이징아웃: 이동량 합이 정확히 px이고 처음 프레임이 마지막보다 크다', () => {
    const kb = createKnockback();
    startKnockback(kb, 3, 4, 10, 150);
    const steps: number[] = [];
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < 20; i++) {
      const d = stepKnockback(kb, 1000 / 60);
      sx += d.dx;
      sy += d.dy;
      steps.push(Math.hypot(d.dx, d.dy));
    }
    expect(Math.hypot(sx, sy)).toBeCloseTo(10, 6);
    expect(sx / sy).toBeCloseTo(3 / 4, 6);
    expect(steps[0]).toBeGreaterThan(steps[7] ?? 0);
    expect(kb.ms).toBe(0);
  });

  it('dt 0(히트스톱·일시정지)이면 움직이지 않는다, 방향 0이면 시작하지 않는다', () => {
    const kb = createKnockback();
    startKnockback(kb, 1, 0, 4, 100);
    expect(stepKnockback(kb, 0)).toEqual({ dx: 0, dy: 0 });
    const none = createKnockback();
    startKnockback(none, 0, 0, 4, 100);
    expect(none.ms).toBe(0);
  });
});

describe('화면 연출 계산', () => {
  it('프레임 → ms (60fps)', () => {
    expect(framesToMs(2)).toBeCloseTo(33.33, 1);
    expect(framesToMs(-1)).toBe(0);
  });

  it('흔들림 px를 뷰포트 비율로, 강도 배율 적용', () => {
    expect(shakeIntensity(3, 960, 540)).toEqual({ x: 3 / 960, y: 3 / 540 });
    expect(shakeIntensity(6, 960, 540, 0.5).x).toBeCloseTo(3 / 960);
    expect(shakeIntensity(6, 960, 540, 0)).toEqual({ x: 0, y: 0 });
  });

  it('데미지 숫자: 위로 튀고 크게 떴다 줄고 끝에 사라짐', () => {
    const cfg = { jumpPx: 16, popScale: 1.5, popMs: 90, fadeFromK: 0.6 };
    const a0 = numberAnim(0, 650, cfg);
    const a1 = numberAnim(300, 650, cfg);
    const a2 = numberAnim(650, 650, cfg);
    expect(a0.scaleMul).toBeCloseTo(1.5);
    expect(a1.scaleMul).toBe(1);
    expect(a1.dy).toBeLessThan(0);
    expect(a1.alpha).toBe(1);
    expect(a2.dy).toBeCloseTo(-16);
    expect(a2.alpha).toBe(0);
  });

  it('알파 페이드: fadeFromK 전까지 유지', () => {
    expect(fadeAlpha(0.5, 1, 0, 0.7)).toBe(1);
    expect(fadeAlpha(0.85, 1, 0, 0.7)).toBeCloseTo(0.5);
    expect(fadeAlpha(0.5, 0.7, 0)).toBeCloseTo(0.35);
  });

  it('줌 펀치 곡선: 올라갔다 내려와 0', () => {
    expect(punchCurve(0, 50, 200)).toBe(0);
    expect(punchCurve(50, 50, 200)).toBe(1);
    expect(punchCurve(150, 50, 200)).toBeGreaterThan(0);
    expect(punchCurve(250, 50, 200)).toBe(0);
    expect(punchCurve(-1, 50, 200)).toBe(0);
  });

  it('콤보: 창 안이면 이어지고 지나면 끊김', () => {
    const c = new Combo(2000);
    expect(c.add(0)).toBe(1);
    expect(c.add(1500)).toBe(2);
    expect(c.add(3000)).toBe(3);
    expect(c.expire(4000)).toBe(false);
    expect(c.expire(5001)).toBe(true);
    expect(c.add(5100)).toBe(1);
  });
});

describe('CappedPool', () => {
  it('상한까지는 새로, 넘으면 가장 오래 전에 꺼낸 활성 항목을 재사용', () => {
    let made = 0;
    const p = new CappedPool(() => ({ id: made++ }), 3);
    const a = p.acquire();
    const b = p.acquire();
    const c = p.acquire();
    expect([a.recycled, b.recycled, c.recycled]).toEqual([false, false, false]);
    const d = p.acquire();
    expect(d.recycled).toBe(true);
    expect(d.item).toBe(a.item);
    expect(p.size).toBe(3);
    const e = p.acquire();
    expect(e.item).toBe(b.item);
    p.release(c.item);
    const f = p.acquire();
    expect(f.recycled).toBe(false);
    expect(made).toBe(3);
  });
});

describe('레이어 순서(PRD §6.4)', () => {
  it('바닥 → 데칼 → 그림자 → 유닛 → 투사체 → 폭발 → 연기 → UI 순으로 depth가 커진다', () => {
    const values = LAYER_ORDER.map((k) => Depth[k]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1] ?? -Infinity);
    expect(Depth.Spark).toBeGreaterThan(Depth.Explosion);
    expect(Depth.Spark).toBeLessThan(Depth.Smoke);
    expect(Depth.DamageText).toBeLessThan(Depth.Ui);
  });
});
