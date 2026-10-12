import type * as Phaser from 'phaser';
import combat from '../data/combat.json';
import feelData from '../data/feel.json';
import weaponsData from '../data/weapons.json';
import { parseColor, startKnockback } from '../core/feel';
import type { Progression } from '../core/progression';
import type { Rng } from '../core/rng';
import type { StatMod } from '../core/stats';
import { Depth } from '../config/depth';
import { MAX_ENEMY_RADIUS, type Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { CardSystem } from './cards';
import type { GameClock } from './clock';
import type { EffectContext, Point } from './effects';
import type { EnemySystem } from './enemies';
import type { Feel } from './feel';
import type { BulletSpec, LobSpec, ProjectileSystem } from './projectiles';
import type { AudioSink } from './audio';

const RIFLE = weaponsData.weapons.rifle;
const GRENADE = weaponsData.weapons.grenade;
const MARK = feelData.allyMarker;
/** 직선 돌파를 몇 토막으로 나눠 앞에서부터 쓸고 지나갈지, 토막 사이 간격 */
const LINE_STEPS = 5;
const LINE_STEP_MS = 50;

/** 전투 쪽 실제 동작(BattleScene이 넘겨줌) */
export interface RunnerDeps {
  scene: Phaser.Scene;
  clock: GameClock;
  player: Player;
  enemies: EnemySystem;
  projectiles: ProjectileSystem;
  feel: Feel;
  audio: AudioSink;
  cards: CardSystem;
  progression: Progression;
  rng: Rng;
  explode(x: number, y: number, radius: number, mult: number, fx: string | undefined, fxScale: number, impact: string | undefined): void;
  damageEnemy(e: Enemy, mult: number, dirX: number, dirY: number, aoe: boolean): void;
  onPlayerHurt(amount: number): void;
  addTp(n: number): void;
  toast(msg: string, color?: string): void;
  /** 통신 복구가 풀 수 있는 플레이어 디버프 id(마이너스 카드 버프) */
  debuffIds: ReadonlySet<string>;
}

interface Marker {
  x: number;
  y: number;
  r: number;
  startMs: number;
  untilMs: number;
}

/** EffectContext 구현: 효과 레지스트리(systems/effects)가 전투에 손대는 유일한 통로 */
export class EffectRunner implements EffectContext {
  private timers: { atMs: number; fn: () => void }[] = [];
  private markers: Marker[] = [];
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(private readonly d: RunnerDeps) {
    this.gfx = d.scene.add.graphics().setDepth(Depth.Decal + 1);
  }

  get nowMs(): number {
    return this.d.clock.timeMs;
  }

  get player(): Point & { facing: number } {
    const p = this.d.player;
    return { x: p.x, y: p.y, facing: p.facing };
  }

  rand(): number {
    return this.d.rng.next();
  }

  fireBullet(toX: number, toY: number, damage: number, rangePx: number): void {
    const spec: BulletSpec = {
      sprite: RIFLE.sprite,
      scale: RIFLE.scale,
      speed: RIFLE.projectileSpeed,
      radius: RIFLE.radius,
      pierce: 0,
      damageMult: damage,
      rangePx,
    };
    this.d.projectiles.fireBullet(spec, this.d.player.x, this.d.player.y, toX, toY);
  }

  lob(toX: number, toY: number, damage: number, aoe: number): void {
    const spec: LobSpec = {
      sprite: GRENADE.sprite,
      scale: GRENADE.scale,
      flightMs: GRENADE.flightMs,
      arcHeight: GRENADE.arcHeight,
      aoeRadius: aoe,
      damageMult: damage,
      fx: GRENADE.fx,
      fxScale: GRENADE.fxScale,
      impact: GRENADE.impact,
    };
    this.d.projectiles.lob(spec, this.d.player.x, this.d.player.y, toX, toY);
  }

  explode(x: number, y: number, radius: number, damage: number, fx: string, fxScale: number): void {
    this.d.explode(x, y, radius, damage, fx, fxScale, 'impact_s');
  }

  nearestEnemies(n: number, rangePx: number): Point[] {
    const p = this.d.player;
    const found: { e: Enemy; d2: number }[] = [];
    this.d.enemies.grid.forEachNear(p.x, p.y, rangePx, (e, d2) => {
      if (e.alive) found.push({ e, d2 });
    });
    found.sort((a, b) => a.d2 - b.d2);
    return found.slice(0, n).map(({ e }) => ({ x: e.x, y: e.y }));
  }

  densestPoint(radius: number): Point | null {
    const view = this.d.scene.cameras.main.worldView;
    const list = this.d.enemies.pool.active;
    // 많을 때는 일부만 후보로(최대 48개) — 정확한 최댓값보다 프레임 비용이 중요
    const stride = Math.max(1, Math.floor(list.length / 48));
    let best: Enemy | null = null;
    let bestCount = 0;
    for (let i = 0; i < list.length; i += stride) {
      const e = list[i] as Enemy;
      if (!e.alive || !view.contains(e.x, e.y)) continue;
      let count = 0;
      this.d.enemies.grid.forEachNear(e.x, e.y, radius, (o) => {
        if (o.alive) count++;
      });
      if (count > bestCount) {
        best = e;
        bestCount = count;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /** 직선 돌파: 앞 토막부터 차례로 피해·밀어내기·흙먼지(전차 연출은 D10) */
  damageLine(from: Point, to: Point, width: number, damage: number, knockbackPx: number): void {
    const hit = new Set<Enemy>();
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const half = width / 2;
    const seg = len / LINE_STEPS;
    const sx = from.x;
    const sy = from.y;
    for (let i = 0; i < LINE_STEPS; i++) {
      this.schedule(i * LINE_STEP_MS, () => {
        const cx = sx + ux * seg * (i + 0.5);
        const cy = sy + uy * seg * (i + 0.5);
        this.d.feel.hit('impact_s', cx, cy - combat.bodyOffsetY * 0.4, { groundY: cy });
        this.d.enemies.grid.forEachNear(cx, cy, seg / 2 + half + MAX_ENEMY_RADIUS, (e) => {
          if (!e.alive || hit.has(e)) return;
          // 선분까지의 수직 거리로 폭 판정
          const t = (e.x - sx) * ux + (e.y - sy) * uy;
          if (t < 0 || t > len) return;
          const px = sx + ux * t;
          const py = sy + uy * t;
          const r = half + e.radius;
          if ((e.x - px) ** 2 + (e.y - py) ** 2 > r * r) return;
          hit.add(e);
          this.d.damageEnemy(e, damage, ux, uy, true);
          if (e.alive) startKnockback(e.kb, ux, uy, knockbackPx, 160);
        });
      });
    }
  }

  stunArea(at: Point, radius: number, ms: number): void {
    const until = this.nowMs + ms;
    this.d.enemies.grid.forEachNear(at.x, at.y, radius + MAX_ENEMY_RADIUS, (e, d2) => {
      const r = radius + e.radius;
      if (e.alive && d2 <= r * r) e.stunUntilMs = Math.max(e.stunUntilMs, until);
    });
  }

  heal(pct: number): void {
    const p = this.d.player;
    const amount = Math.max(1, Math.round(p.maxHp * pct));
    p.hp = Math.min(p.maxHp, p.hp + amount);
    this.d.feel.numbers.show('heal', p.x, p.y - combat.bodyOffsetY - 10, `+${amount}`);
    this.d.feel.flash(p.sprite, parseColor(feelData.numbers.styles.heal.color), 120);
    this.d.audio.play('heal');
  }

  hurtPlayer(pct: number, stunMs: number): void {
    const p = this.d.player;
    const amount = Math.max(1, Math.round(p.maxHp * pct));
    // 카드 효과로는 쓰러지지 않는다(체력 1 남김)
    const dealt = Math.min(amount, p.hp - 1);
    p.hp -= Math.max(0, dealt);
    p.stunUntilMs = Math.max(p.stunUntilMs, this.nowMs + stunMs);
    this.d.feel.flash(p.sprite, parseColor(feelData.playerFlash.hurt), combat.playerHurtFlashMs);
    this.d.feel.hit('player_hit', p.x, p.y - combat.bodyOffsetY, { amount, groundY: p.y });
    this.d.onPlayerHurt(Math.max(0, dealt));
  }

  addBuff(id: string, mods: StatMod[], ms: number): void {
    this.d.player.addBuff(id, mods, ms, this.nowMs);
    this.d.audio.play(this.d.debuffIds.has(id) ? 'debuff' : 'buff_up');
  }

  marker(at: Point, radius: number, ms: number): void {
    this.markers.push({ x: at.x, y: at.y, r: radius, startMs: this.nowMs, untilMs: this.nowMs + ms });
    // 포격 예고는 휘파람(짧은 범위 표시는 소리 없음)
    if (ms >= 400) this.d.audio.play('strike_whistle', at.x, at.y);
  }

  schedule(delayMs: number, fn: () => void): void {
    if (delayMs <= 0) fn();
    else this.timers.push({ atMs: this.nowMs + delayMs, fn });
  }

  flashEnemiesOnScreen(ms: number): void {
    const view = this.d.scene.cameras.main.worldView;
    const color = parseColor(feelData.enemyReveal.color);
    for (const e of this.d.enemies.pool.active) {
      if (e.alive && view.contains(e.x, e.y)) this.d.feel.flash(e.sprite, color, ms);
    }
  }

  toast(msg: string, color?: string): void {
    this.d.toast(msg, color);
  }

  readonly cards = {
    primeIntel: (): void => void this.d.cards.act({ type: 'primeIntel' }),
    penalty: (value: number, submits: number): void => void this.d.cards.act({ type: 'penalty', value, submits }),
    grantOp: (n: number): void => void this.d.cards.act({ type: 'grantOp', amount: n }),
    shuffleHand: (): void => void this.d.cards.act({ type: 'shuffleHand' }),
  };

  readonly progression = {
    /** 다음 레벨업 보정은 겹치면 더 좋은 쪽(선택지 수·배율은 큰 값, 희귀 보너스는 합) */
    bonus: (b: { count?: number; rarePlusBonus?: number; valueMultiplier?: number }): void => {
      const cur = this.d.progression.nextBonus;
      if (b.count !== undefined) cur.count = Math.max(cur.count ?? 0, b.count);
      if (b.rarePlusBonus !== undefined) cur.rarePlusBonus = (cur.rarePlusBonus ?? 0) + b.rarePlusBonus;
      if (b.valueMultiplier !== undefined) cur.valueMultiplier = Math.max(cur.valueMultiplier ?? 1, b.valueMultiplier);
    },
    addRerolls: (n: number): void => {
      this.d.progression.rerolls += n;
    },
  };

  addTp(n: number): void {
    this.d.addTp(n);
  }

  /** 방해 하나 해제: 플레이어 디버프(가장 최근) → 카드 성공률 감소 순. 적 방해(재밍 등)는 해당 Day에 추가 */
  clearDisruption(): boolean {
    const p = this.d.player;
    for (let i = p.buffs.list.length - 1; i >= 0; i--) {
      const b = p.buffs.list[i];
      if (b && this.d.debuffIds.has(b.id)) {
        p.removeBuff(b.id);
        this.d.audio.play('buff_up');
        this.toast('방해 해제');
        return true;
      }
    }
    if (this.d.cards.state.penalties.length > 0) {
      this.d.cards.act({ type: 'clearPenalty' });
      this.toast('오보 정정');
      return true;
    }
    return false;
  }

  /** 매 프레임: 예약 실행(전투 시계라 일시정지·레벨업 중에는 멈춤) + 예고 마커 그리기 */
  update(): void {
    const now = this.nowMs;
    if (this.timers.length > 0) {
      const due = this.timers.filter((t) => t.atMs <= now);
      if (due.length > 0) {
        this.timers = this.timers.filter((t) => t.atMs > now);
        for (const t of due) t.fn();
      }
    }
    this.markers = this.markers.filter((m) => m.untilMs > now);
    const g = this.gfx.clear();
    const color = parseColor(MARK.color);
    for (const m of this.markers) {
      // 착탄 직전일수록 빨리 깜빡이고 안쪽 원이 커진다
      const k = Math.min(1, (now - m.startMs) / Math.max(1, m.untilMs - m.startMs));
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin((now / MARK.pulseMs) * Math.PI * (1 + k)));
      g.fillStyle(color, MARK.fillAlpha).fillCircle(m.x, m.y, m.r);
      g.lineStyle(1, color, MARK.lineAlpha * pulse).strokeCircle(m.x, m.y, m.r);
      g.lineStyle(1, color, MARK.lineAlpha).strokeCircle(m.x, m.y, m.r * k);
    }
  }

  /** 지금 걸려 있는 예약 수(디버그) */
  get pending(): number {
    return this.timers.length;
  }
}
