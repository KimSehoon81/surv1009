// 효과 레지스트리(PRD §5.3.1): 효과 ID → 처리 함수(ctx, params, power). 수치는 data(cards.json params).
// 원자 단위(사격·곡사·지점 포격·직선 돌파·회복·버프·카드/레벨업 보정)로 쪼개 D10~D11 조합 스킬과 D20 무기가 재사용한다.
// Phaser를 직접 쓰지 않는다(전투 쪽은 EffectContext로만 접근) → 등록 여부를 테스트할 수 있다.

import type { StatMod } from '../core/stats';

export interface Point {
  x: number;
  y: number;
}

/** 효과가 전투에 할 수 있는 일(BattleScene 쪽 EffectRunner가 구현) */
export interface EffectContext {
  readonly nowMs: number;
  /** 플레이어 발 위치·바라보는 방향 */
  readonly player: Point & { facing: number };
  /** 0~1 난수(시드 RNG) */
  rand(): number;
  /** 플레이어 몸통에서 목표 쪽으로 총알 */
  fireBullet(toX: number, toY: number, damage: number, rangePx: number): void;
  /** 플레이어에게서 목표 지점으로 곡사(수류탄) */
  lob(toX: number, toY: number, damage: number, aoe: number): void;
  /** 지점 폭발(범위 피해 + 이펙트 + 착탄 연출) */
  explode(x: number, y: number, radius: number, damage: number, fx: string, fxScale: number): void;
  nearestEnemies(n: number, rangePx: number): Point[];
  /** 화면 안에서 적이 가장 많이 모인 지점(없으면 null) */
  densestPoint(radius: number): Point | null;
  damageLine(from: Point, to: Point, width: number, damage: number, knockbackPx: number): void;
  stunArea(at: Point, radius: number, ms: number): void;
  /** 최대 체력 비율 회복 */
  heal(pct: number): void;
  /** 플레이어 피해(최대 체력 비율, 쓰러뜨리지 않음) + 기절 */
  hurtPlayer(pct: number, stunMs: number): void;
  addBuff(id: string, mods: StatMod[], ms: number): void;
  /** 아군 범위 예고 마커(청록, PRD §6.4) */
  marker(at: Point, radius: number, ms: number): void;
  /** 전투 시계 기준 지연 실행 */
  schedule(delayMs: number, fn: () => void): void;
  flashEnemiesOnScreen(ms: number): void;
  toast(msg: string, color?: string): void;
  cards: { primeIntel(): void; penalty(value: number, submits: number): void; grantOp(n: number): void; shuffleHand(): void };
  progression: { bonus(b: { count?: number; rarePlusBonus?: number; valueMultiplier?: number }): void; addRerolls(n: number): void };
  addTp(n: number): void;
  /** 방해 하나 해제(없으면 false) */
  clearDisruption(): boolean;
}

export type Params = Readonly<Record<string, number | string>>;
export type EffectHandler = (ctx: EffectContext, p: Params, power: number) => void;

const num = (p: Params, k: string, d = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : d);
const str = (p: Params, k: string, d = ''): string => (typeof p[k] === 'string' ? (p[k] as string) : d);

/** 바라보는 쪽 앞(적이 없을 때의 기본 조준점) */
const front = (ctx: EffectContext, dist = 120): Point => ({ x: ctx.player.x + ctx.player.facing * dist, y: ctx.player.y });

export const EFFECTS: Record<string, EffectHandler> = {
  /** 주변 원형 일제 사격 */
  radialShots(ctx, p, power) {
    const n = num(p, 'count', 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.fireBullet(ctx.player.x + Math.cos(a) * 100, ctx.player.y + Math.sin(a) * 100, num(p, 'damage', 1) * power, num(p, 'range', 260));
    }
  },

  /** 가까운 적 n명에게 한 발씩 */
  shots(ctx, p, power) {
    const targets = ctx.nearestEnemies(num(p, 'count', 3), num(p, 'range', 300));
    for (const t of targets) ctx.fireBullet(t.x, t.y, num(p, 'damage', 1) * power, num(p, 'range', 300));
  },

  /** 가까운 적들에게 곡사(없으면 앞쪽 흩뿌림) */
  lobs(ctx, p, power) {
    const n = num(p, 'count', 3);
    const targets = ctx.nearestEnemies(n, 280);
    for (let i = 0; i < n; i++) {
      const f = front(ctx, 90);
      const t = targets[i] ?? { x: f.x + (ctx.rand() - 0.5) * 120, y: f.y + (ctx.rand() - 0.5) * 120 };
      ctx.lob(t.x, t.y, num(p, 'damage', 1) * power, num(p, 'aoe', 44));
    }
  },

  /** 지점 포격: 예고 마커 → 지연 후 폭발, count발을 interval 간격·spread 범위로 */
  strikes(ctx, p, power) {
    const r = num(p, 'radius', 40);
    const base = ctx.densestPoint(r * 2) ?? front(ctx);
    const n = num(p, 'count', 1);
    for (let i = 0; i < n; i++) {
      const s = num(p, 'spreadPx', 0);
      const at = { x: base.x + (ctx.rand() - 0.5) * 2 * s, y: base.y + (ctx.rand() - 0.5) * 2 * s };
      const delay = num(p, 'delayMs', 600) + i * num(p, 'intervalMs', 0);
      ctx.marker(at, r, delay);
      ctx.schedule(delay, () => ctx.explode(at.x, at.y, r, num(p, 'damage', 1) * power, str(p, 'fx', 'explosion_s'), num(p, 'fxScale', 1)));
    }
  },

  /** 직선 돌파(전차): 적이 많은 쪽으로 length만큼 */
  line(ctx, p, power) {
    const target = ctx.densestPoint(80) ?? front(ctx);
    const dx = target.x - ctx.player.x;
    const dy = target.y - ctx.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const L = num(p, 'length', 300);
    const to = { x: ctx.player.x + (dx / len) * L, y: ctx.player.y + (dy / len) * L };
    ctx.damageLine(ctx.player, to, num(p, 'width', 40), num(p, 'damage', 1) * power, num(p, 'knockback', 16) * power);
  },

  /** 시한폭탄: 지금 자리에 설치, 지연 후 대폭발 */
  timebomb(ctx, p, power) {
    const at = { x: ctx.player.x, y: ctx.player.y };
    const r = num(p, 'radius', 80);
    const delay = num(p, 'delayMs', 3000);
    ctx.marker(at, r, delay);
    ctx.schedule(delay, () => ctx.explode(at.x, at.y, r, num(p, 'damage', 3) * power, 'explosion_l', 0.6));
  },

  heal(ctx, p, power) {
    ctx.heal(num(p, 'pct', 0.1) * power);
  },

  /** 지원 사격: duration 동안 interval마다 가장 가까운 적에게 */
  support(ctx, p, power) {
    const dur = num(p, 'durationMs', 3000);
    const step = Math.max(50, num(p, 'intervalMs', 200));
    for (let t = 0; t < dur; t += step) {
      ctx.schedule(t, () => {
        const [e] = ctx.nearestEnemies(1, 320);
        if (e) ctx.fireBullet(e.x, e.y, num(p, 'damage', 0.6) * power, 320);
      });
    }
  },

  /** 척후 보고: 적 표시 + 다음 제출 정보 보너스 */
  scout(ctx, p) {
    ctx.flashEnemiesOnScreen(num(p, 'flashMs', 400));
    ctx.cards.primeIntel();
    ctx.toast('척후 보고: 다음 작전 +10%p');
  },

  /** 정찰기(공군 실패 잔효): ms 동안 2초마다 화면 안 적 표시 */
  recon(ctx, p) {
    const dur = num(p, 'ms', 20000);
    for (let t = 0; t < dur; t += 2000) ctx.schedule(t, () => ctx.flashEnemiesOnScreen(400));
    ctx.toast(`정찰기: ${Math.round(dur / 1000)}초간 적 표시`);
  },

  clearDisruption(ctx) {
    if (!ctx.clearDisruption()) ctx.toast('해제할 방해가 없음');
  },

  /** 다음 레벨업 보정(작전계획서·정찰 보고서·참모 회의) */
  nextLevelUp(ctx, p) {
    const b: { count?: number; rarePlusBonus?: number; valueMultiplier?: number } = {};
    if (p.count !== undefined) b.count = num(p, 'count');
    if (p.rarePlusBonus !== undefined) b.rarePlusBonus = num(p, 'rarePlusBonus');
    if (p.valueMultiplier !== undefined) b.valueMultiplier = num(p, 'valueMultiplier');
    ctx.progression.bonus(b);
    ctx.toast('다음 레벨업 강화');
  },

  rerolls(ctx, p) {
    ctx.progression.addRerolls(num(p, 'amount', 1));
    ctx.toast(`리롤 +${num(p, 'amount', 1)}`);
  },

  /** 시간제 버프·디버프(stat2·value2로 두 번째 수정자) */
  buff(ctx, p, power) {
    const op = str(p, 'op', 'mul') === 'add' ? 'add' : 'mul';
    const mods: StatMod[] = [{ stat: str(p, 'stat'), op, value: num(p, 'value') * power }];
    if (p.stat2 !== undefined) mods.push({ stat: str(p, 'stat2'), op: 'add', value: num(p, 'value2') * power });
    ctx.addBuff(str(p, 'id', 'buff'), mods, num(p, 'ms', 10000));
  },

  cardPenalty(ctx, p, power) {
    ctx.cards.penalty(num(p, 'value', 0.1) * power, num(p, 'submits', 3));
  },

  /** 아군 오폭: 플레이어 곁 폭발 연출 + 피해 + 짧은 기절(쓰러뜨리지는 않음) */
  friendlyFire(ctx, p, power) {
    ctx.explode(ctx.player.x - ctx.player.facing * 18, ctx.player.y + 6, 0, 0, 'explosion_s', 0.8);
    ctx.hurtPlayer(num(p, 'pct', 0.08) * power, num(p, 'stunMs', 600));
  },

  shuffleHand(ctx) {
    ctx.cards.shuffleHand();
  },

  opGain(ctx, p, power) {
    ctx.cards.grantOp(Math.round(num(p, 'amount', 1) * power));
  },

  tp(ctx, p, power) {
    ctx.addTp(num(p, 'amount', 5) * power);
  },

  /** 철조망(공병 실패 잔효): 주변 적 잠깐 멈춤 */
  stunArea(ctx, p) {
    const r = num(p, 'radius', 80);
    ctx.marker(ctx.player, r, 300);
    ctx.stunArea(ctx.player, r, num(p, 'ms', 1000));
  },
};

export function runEffect(id: string, ctx: EffectContext, params: Params, power = 1): boolean {
  const h = EFFECTS[id];
  if (!h) return false;
  h(ctx, params, power);
  return true;
}
