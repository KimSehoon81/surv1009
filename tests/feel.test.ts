import { describe, expect, it } from 'vitest';
import feel from '../src/data/feel.json';
import sfx from '../src/data/sfx.json';
import {
  Combo,
  createKnockback,
  fadeAlpha,
  framesToMs,
  hitstopAllowed,
  numberAnim,
  parseColor,
  punchCurve,
  punchRestartElapsed,
  Shaker,
  StopBudget,
  lodAllows,
  startKnockback,
  stepKnockback,
} from '../src/core/feel';
import { CappedPool } from '../src/core/pool';
import { Depth, LAYER_ORDER } from '../src/config/depth';

type Preset = Record<string, unknown>;
const presets = feel.presets as unknown as Record<string, Preset>;

describe('PRD §4.4 프리셋 수치', () => {
  it('히트스톱 2(맞은 적만 국소)/5/10프레임, 대형 처치 슬로모 0.3배 0.5초', () => {
    expect(presets.normal?.localStopFrames).toBe(2);
    expect(presets.normal?.hitstopFrames).toBeUndefined();
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
      if (p.fx !== undefined) expect(Object.keys(feel.fxTiming), name).toContain(p.fx);
      if (p.sfx !== undefined) expect(Object.keys(sfx.cues), name).toContain(p.sfx);
      for (const kind of Object.keys((p.emit as Record<string, number> | undefined) ?? {})) expect(Object.keys(feel.particles.kinds), name).toContain(kind);
    }
    expect(Object.keys(sfx.cues)).toContain(feel.muzzle.sfx);
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

  it('흔들림: 시간이 지나면 0, 정수 px, 강도 0이면 없음', () => {
    const sh = new Shaker(8);
    sh.addShake(3, 150, 0);
    expect(sh.amplitude(0)).toBe(3);
    expect(sh.amplitude(75)).toBeCloseTo(1.5);
    expect(sh.amplitude(150)).toBe(0);
    const o = sh.sample(10, () => 0.99, 1);
    expect(Number.isInteger(o.x) && Number.isInteger(o.y)).toBe(true);
    expect(Math.abs(o.x)).toBeLessThanOrEqual(3);
    expect(sh.sample(10, () => 0.99, 0)).toEqual({ x: 0, y: 0 });
  });

  it('흔들림 누적: 일반 타격은 가장 강한 하나만, 연속 착탄(stack)은 겹칠수록 커지고 상한', () => {
    const plain = new Shaker(8);
    for (let i = 0; i < 5; i++) plain.addShake(2, 200, 0);
    expect(plain.amplitude(0)).toBe(2);
    const stack = new Shaker(8);
    for (let i = 0; i < 3; i++) stack.addShake(2, 200, 0, true);
    expect(stack.amplitude(0)).toBe(4); // 2 + (6-2)/2
    for (let i = 0; i < 8; i++) stack.addShake(2, 200, 0, true);
    expect(stack.amplitude(0)).toBe(8);
  });

  it('방향 킥: 타격 방향으로 밀었다가 돌아옴', () => {
    const sh = new Shaker(8);
    sh.addKick(1, 0, 3, 100, 0);
    expect(sh.sample(0, () => 0.5, 1)).toEqual({ x: 3, y: 0 });
    expect(sh.sample(100, () => 0.5, 1)).toEqual({ x: 0, y: 0 });
  });

  it('정지 예산: 길게 보면 정지가 20%를 넘지 않음, 대형 처치(force)는 예외', () => {
    const b = new StopBudget(0.2, 200);
    let stopped = 0;
    // 1초 동안 매 프레임 치명타 정지(83ms) 요청
    for (let t = 0; t < 10000; t += 16) if (b.request(t, 83)) stopped += 83;
    expect(stopped / 10000).toBeLessThanOrEqual(0.2 + 0.03);
    expect(b.request(10000, 167, true)).toBe(true);
  });

  it('LOD: 프레임 예산 안이거나 우선순위가 높으면 전체 연출', () => {
    expect(lodAllows(0, 6, 10, 50)).toBe(true);
    expect(lodAllows(6, 6, 10, 50)).toBe(false);
    expect(lodAllows(99, 6, 50, 50)).toBe(true);
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

describe('히트스톱 판정·줌 이어 붙이기', () => {
  it('간격 없는 프리셋(치명·대형 처치)은 다른 히트스톱 중에도 건다, 간격 있는 일반 타격만 생략', () => {
    // 처치 타격: 같은 프레임에 normal(2f)이 먼저 걸린 직후 kill_big(10f)
    const lastEnd = 1000 + 33;
    expect(hitstopAllowed(1000, lastEnd, undefined)).toBe(true);
    expect(hitstopAllowed(1000, lastEnd, 100)).toBe(false);
    expect(hitstopAllowed(1133, lastEnd, 100)).toBe(true);
  });

  it('진행 중인 줌에서 더 큰 펀치로 바꿔도 값이 내려가지 않는다', () => {
    const inMs = 50;
    const outMs = 200;
    // 대형 처치 0.04 펀치가 줄어드는 중 → 0.02 치명 펀치
    const current = 0.04 * punchCurve(220, inMs, outMs);
    expect(current).toBeLessThan(0.02);
    const t0 = punchRestartElapsed(current, 0.02, inMs);
    expect(0.02 * punchCurve(t0, inMs, outMs)).toBeCloseTo(current, 6);
    expect(0.02 * punchCurve(t0 + 16, inMs, outMs)).toBeGreaterThan(current);
    expect(punchRestartElapsed(0, 0.02, inMs)).toBe(0);
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
    // 지금 활성 순서: d(=a) → e(=b) → f(=c). 다음 재사용은 d
    expect(p.acquire().item).toBe(d.item);
  });

  it('반납·재획득이 섞여도 가장 오래된 활성 항목을 고른다(대량)', () => {
    const p = new CappedPool(() => ({}), 50);
    const live: object[] = [];
    for (let i = 0; i < 5000; i++) {
      if (live.length > 0 && i % 7 === 0) p.release(live.splice(i % live.length, 1)[0] as object);
      const { item, recycled } = p.acquire();
      if (recycled) {
        expect(item).toBe(live[0]);
        live.shift();
      }
      live.push(item);
      expect(p.size).toBeLessThanOrEqual(50);
    }
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
