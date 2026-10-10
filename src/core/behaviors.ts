// 적 행동 부품(PRD §7.4). 적마다 data의 behaviors 배열을 조합해 이동 방향을 정한다.
// 새 적은 부품 조합으로 만들고, 새 움직임이 필요하면 여기에 부품을 하나 추가한다(적별 코드 분기 금지).
// 인터페이스: (agent, spec, ctx, out) → out에 방향 기여분을 더한다. 마지막에 정규화해 속도를 곱한다.

export interface Agent {
  x: number;
  y: number;
  /** 등장 후 경과 시간(ms, 전투 시계) */
  ageMs: number;
  /** 개체마다 다른 위상(0~1). 같은 종류가 똑같이 움직이지 않게 */
  phase: number;
}

export interface BehaviorSpec {
  type: string;
  [param: string]: number | string;
}

export interface SteerCtx {
  targetX: number;
  targetY: number;
}

export interface Vec {
  x: number;
  y: number;
}

type BehaviorFn = (a: Agent, spec: BehaviorSpec, ctx: SteerCtx, out: Vec) => void;

const num = (spec: BehaviorSpec, key: string, fallback: number): number => {
  const v = spec[key];
  return typeof v === 'number' ? v : fallback;
};

export const BEHAVIORS: Record<string, BehaviorFn> = {
  /** 목표를 향해 직선 추적 */
  chase(a, spec, ctx, out) {
    const dx = ctx.targetX - a.x;
    const dy = ctx.targetY - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const w = num(spec, 'weight', 1);
    out.x += (dx / len) * w;
    out.y += (dy / len) * w;
  },
  /** 추적 방향의 옆으로 사인파 흔들기(지그재그 접근). amplitude=옆 방향 비중, freq=초당 왕복 */
  zigzag(a, spec, ctx, out) {
    const dx = ctx.targetX - a.x;
    const dy = ctx.targetY - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const s = Math.sin(((a.ageMs / 1000) * num(spec, 'freq', 2) + a.phase) * Math.PI * 2) * num(spec, 'amplitude', 0.8);
    out.x += (-dy / len) * s;
    out.y += (dx / len) * s;
  },
};

/** 행동 부품을 합친 이동 방향(길이 1, 기여가 없으면 0) */
export function steer(a: Agent, specs: readonly BehaviorSpec[], ctx: SteerCtx): Vec {
  const out = { x: 0, y: 0 };
  for (const spec of specs) {
    const fn = BEHAVIORS[spec.type];
    if (!fn) throw new Error(`알 수 없는 행동 부품: ${spec.type}`);
    fn(a, spec, ctx, out);
  }
  const len = Math.hypot(out.x, out.y);
  return len < 1e-6 ? { x: 0, y: 0 } : { x: out.x / len, y: out.y / len };
}
