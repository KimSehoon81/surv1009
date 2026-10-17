import type * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import combat from '../data/combat.json';
import { FRAME_MS, parseColor } from '../core/feel';
import { phaseMs, type AttackEvent, type AttackSpec } from '../core/enemyAttack';
import { Depth } from '../config/depth';
import type { Enemy } from '../entities/Enemy';
import type { AudioSink } from './audio';
import type { Feel } from './feel';

const TM = feelData.threatMarker;
const RED = parseColor(TM.color);
const GUARD = parseColor(feelData.guardRing.guard);
const WEAK = parseColor(feelData.guardRing.weak);

/** 곡사 탄착점: 목표 하나 + count−1개를 spread 반지름 고리에 고르게 */
export function lobPoints(tx: number, ty: number, spec: AttackSpec): { x: number; y: number }[] {
  const n = Math.max(1, spec.count ?? 1);
  const pts = [{ x: tx, y: ty }];
  for (let i = 1; i < n; i++) {
    const a = ((i - 1) / (n - 1)) * Math.PI * 2;
    pts.push({ x: tx + Math.cos(a) * (spec.spread ?? 60), y: ty + Math.sin(a) * (spec.spread ?? 60) * 0.7 });
  }
  return pts;
}

/** 적 공격 예고 모양(붉은 공용 마커): 원(착탄 지점)·선(돌진 경로)·부채꼴(사격 범위) */
export type ThreatShape =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'line'; x: number; y: number; dirX: number; dirY: number; length: number; width: number }
  | { kind: 'fan'; x: number; y: number; dirX: number; dirY: number; range: number; angleDeg: number };

interface Threat {
  shape: ThreatShape;
  startMs: number;
  untilMs: number;
}

interface Shell {
  fromX: number;
  fromY: number;
  tx: number;
  ty: number;
  startMs: number;
  untilMs: number;
}

export interface EnemyAttackHost {
  feel: Feel;
  audio: AudioSink;
  /** 적 공격이 플레이어에게(공격력, 출처 위치). 무적·보호막·방어 판정은 호출부가 */
  hitPlayer(attack: number, fromX: number, fromY: number, cause: string): void;
  /** 단계 이벤트 알림(보스 작전 카드 HUD 등) */
  onEvent?(e: Enemy, ev: AttackEvent, spec: AttackSpec): void;
  player(): { x: number; y: number };
}

/**
 * 적 공격 실행: 단계 이벤트를 받아 붉은 예고 마커·포탄 비행·착탄 피해를 처리하고,
 * 방어 자세·약점 노출 고리를 그린다. 시간은 전투 시계.
 */
export class EnemyAttackSystem {
  private threats: Threat[] = [];
  private shells: Shell[] = [];
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly air: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private readonly host: EnemyAttackHost,
  ) {
    this.gfx = scene.add.graphics().setDepth(Depth.Decal + 1);
    this.air = scene.add.graphics().setDepth(Depth.Projectile);
  }

  get activeThreats(): number {
    return this.threats.length;
  }

  /** 붉은 예고 마커(ms 동안, 마지막 4프레임 수축) */
  telegraph(shape: ThreatShape, nowMs: number, ms: number): void {
    this.threats.push({ shape, startMs: nowMs, untilMs: nowMs + ms });
  }

  onAttack(e: Enemy, ev: AttackEvent, nowMs: number): void {
    const spec = e.attacks[ev.index] as AttackSpec | undefined;
    if (!spec) return;
    this.host.onEvent?.(e, ev, spec);
    const st = e.atk;
    const tele = phaseMs(spec, 'telegraph', combat.minTelegraphMs);
    const cause = (kind: string) => (e.tier === 'boss' ? `boss:${kind}` : kind);
    if (spec.type === 'lob') {
      const pts = lobPoints(st.tx, st.ty, spec);
      if (ev.type === 'telegraph') {
        // 예고 시간 = 포탄 비행 시간(쏘는 순간 마커, 떨어지는 순간 피해)
        for (const p of pts) {
          this.telegraph({ kind: 'circle', x: p.x, y: p.y, r: spec.radius ?? 40 }, nowMs, tele);
          this.shells.push({ fromX: e.x, fromY: e.y, tx: p.x, ty: p.y, startMs: nowMs, untilMs: nowMs + tele });
        }
        e.trigger('attack', nowMs);
        this.host.audio.play('enemy_mortar', e.x, e.y);
      } else if (ev.type === 'active') {
        const p = this.host.player();
        const r = (spec.radius ?? 40) + combat.playerRadius;
        let hit = false;
        for (const q of pts) {
          this.host.feel.hit('impact_s', q.x, q.y - combat.bodyOffsetY * 0.4, { groundY: q.y });
          if (!hit && (p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= r * r) hit = true;
        }
        if (hit) this.host.hitPlayer(e.attack * (spec.damage ?? 1), st.tx, st.ty, cause('lob'));
      }
    } else if (spec.type === 'chargeDash') {
      if (ev.type === 'telegraph') {
        const length = ((spec.speed ?? 300) * spec.activeMs) / 1000;
        this.telegraph({ kind: 'line', x: e.x, y: e.y, dirX: st.dirX, dirY: st.dirY, length, width: spec.width ?? 40 }, nowMs, tele);
        e.trigger('attack', nowMs);
      }
    } else if (spec.type === 'fanShot') {
      const range = spec.range?.[1] ?? 260;
      const angle = spec.angleDeg ?? 60;
      if (ev.type === 'telegraph') {
        this.telegraph({ kind: 'fan', x: e.x, y: e.y, dirX: st.dirX, dirY: st.dirY, range, angleDeg: angle }, nowMs, tele);
      } else if (ev.type === 'active') {
        e.trigger('attack', nowMs);
        this.host.audio.play('shot', e.x, e.y);
        // 탄착 먼지 몇 개 + 부채꼴 안이면 피해
        const base = Math.atan2(st.dirY, st.dirX);
        for (let i = 0; i < 5; i++) {
          const a = base + ((i / 4 - 0.5) * angle * Math.PI) / 180;
          const d = range * (0.5 + 0.12 * i);
          this.host.feel.hit('strafe_hit', e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, { groundY: e.y + Math.sin(a) * d });
        }
        const p = this.host.player();
        const dx = p.x - e.x;
        const dy = p.y - e.y;
        const dist = Math.hypot(dx, dy);
        const off = Math.abs(Math.atan2(st.dirX * dy - st.dirY * dx, st.dirX * dx + st.dirY * dy));
        if (dist <= range + combat.playerRadius && off <= ((angle / 2) * Math.PI) / 180) this.host.hitPlayer(e.attack * (spec.damage ?? 1), e.x, e.y, cause('fan'));
      }
    } else if (spec.type === 'opCard') {
      // 판정 성공 뒤: 플레이어 자리에 대형 착탄 예고 → 실행
      if (ev.type === 'telegraph') {
        this.telegraph({ kind: 'circle', x: st.tx, y: st.ty, r: spec.radius ?? 150 }, nowMs, tele);
        this.host.audio.play('strike_whistle', st.tx, st.ty);
      } else if (ev.type === 'active') {
        this.host.feel.hit('impact_l', st.tx, st.ty - combat.bodyOffsetY * 0.4, { groundY: st.ty });
        const p = this.host.player();
        const r = (spec.radius ?? 150) + combat.playerRadius;
        if ((p.x - st.tx) ** 2 + (p.y - st.ty) ** 2 <= r * r) this.host.hitPlayer(e.attack * (spec.damage ?? 1), st.tx, st.ty, cause('card'));
      } else if (ev.type === 'judged' && ev.result !== 'success') e.trigger('hit', nowMs);
    } else if (spec.type === 'guard') {
      if (ev.type === 'active') e.trigger('defend', nowMs);
    }
  }

  /** 매 프레임: 예고 마커·포탄·방어 고리 그리기 */
  update(nowMs: number, enemies: readonly Enemy[]): void {
    this.threats = this.threats.filter((t) => t.untilMs > nowMs);
    this.shells = this.shells.filter((s) => s.untilMs > nowMs);
    const g = this.gfx.clear();
    for (const t of this.threats) this.drawThreat(g, t, nowMs);
    const a = this.air.clear();
    for (const s of this.shells) {
      const k = (nowMs - s.startMs) / Math.max(1, s.untilMs - s.startMs);
      const x = s.fromX + (s.tx - s.fromX) * k;
      const y = s.fromY + (s.ty - s.fromY) * k - Math.sin(k * Math.PI) * 110 - combat.bodyOffsetY * (1 - k);
      a.fillStyle(0x2a2622, 1).fillCircle(x, y, 2.5);
    }
    // 방어 자세(강철색 고리)·약점 노출(주황 깜빡임)
    for (const e of enemies) {
      if (!e.alive || e.atk.index < 0) continue;
      const spec = e.attacks[e.atk.index];
      if (spec?.type !== 'guard') continue;
      if (e.atk.phase === 'active') g.lineStyle(2, GUARD, 0.9).strokeEllipse(e.x, e.y - 2, e.radius * 2.6, e.radius * 1.2);
      else if (e.atk.phase === 'recover' && Math.floor(nowMs / 120) % 2 === 0) g.lineStyle(2, WEAK, 1).strokeEllipse(e.x, e.y - 2, e.radius * 2.8, e.radius * 1.3);
    }
  }

  private drawThreat(g: Phaser.GameObjects.Graphics, t: Threat, now: number): void {
    const left = t.untilMs - now;
    const shrinkMs = TM.shrinkFrames * FRAME_MS;
    const k = left <= shrinkMs ? Math.max(0, left / shrinkMs) : 1;
    const scale = TM.shrinkTo + (1 - TM.shrinkTo) * k;
    const bright = left <= shrinkMs;
    const pulse = bright ? 1 : 0.6 + 0.4 * Math.abs(Math.sin((now / TM.pulseMs) * Math.PI));
    const fillA = TM.fillAlpha * (bright ? 2.5 : 1);
    g.fillStyle(RED, fillA).lineStyle(bright ? 2 : 1, RED, TM.lineAlpha * pulse);
    const s = t.shape;
    if (s.kind === 'circle') {
      g.fillCircle(s.x, s.y, s.r * scale).strokeCircle(s.x, s.y, s.r * scale);
    } else if (s.kind === 'line') {
      const hw = (s.width / 2) * scale;
      const nx = -s.dirY * hw;
      const ny = s.dirX * hw;
      const ex = s.x + s.dirX * s.length;
      const ey = s.y + s.dirY * s.length;
      const pts = [
        { x: s.x + nx, y: s.y + ny },
        { x: ex + nx, y: ey + ny },
        { x: ex - nx, y: ey - ny },
        { x: s.x - nx, y: s.y - ny },
      ];
      g.fillPoints(pts, true).strokePoints(pts, true);
    } else {
      const a = Math.atan2(s.dirY, s.dirX);
      const h = ((s.angleDeg / 2) * Math.PI) / 180;
      g.beginPath().moveTo(s.x, s.y).arc(s.x, s.y, s.range * scale, a - h, a + h).closePath().fillPath().strokePath();
    }
  }
}
