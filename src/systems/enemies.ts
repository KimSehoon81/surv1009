import type * as Phaser from 'phaser';
import { Pool } from '../core/pool';
import { SpatialHash } from '../core/spatialHash';
import { steer } from '../core/behaviors';
import { moveMode, stepAttack, type AttackEvent } from '../core/enemyAttack';
import { stepKnockback } from '../core/feel';
import { enemyScale } from '../core/scaling';
import { accumulate, ringPoint, spawnRadius, takeBurst, type BurstJob } from '../core/spawnLogic';
import { slideDir } from '../core/obstacles';
import type { Rng } from '../core/rng';
import { Depth } from '../config/depth';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Enemy, MAX_ENEMY_RADIUS, isEnemyId, type EnemyId } from '../entities/Enemy';
import enemyData from '../data/enemies.json';

/** 종류별 동시 상한(enemies.json maxAlive): 거리를 두는 원거리 적이 판이 길수록 쌓이지 않게 */
const TYPE_CAP: Partial<Record<string, number>> = Object.fromEntries(
  Object.entries(enemyData.enemies).flatMap(([id, e]) => ('maxAlive' in e && typeof e.maxAlive === 'number' ? [[id, e.maxAlive]] : [])),
);
import { registerUnitAnims, type UnitAnims } from './anims';

export interface SpawnConfig {
  radiusMargin: number;
  despawnFactor: number;
  separationChecks: number;
  poolSize: number;
  stress: number;
}

/** 공격 단계 이벤트를 전투 쪽(예고 마커·포탄·피해)으로 */
export interface AttackHooks {
  onAttack(e: Enemy, ev: AttackEvent, nowMs: number): void;
}

export interface Target {
  x: number;
  y: number;
  radius: number;
}

/**
 * 적 전체 관리: 스폰(시간 기반, 화면 밖 원형), 행동 부품으로 이동, 공간 해시로 겹침 완화, 멀어진 적 재배치.
 * Arcade 물리를 쓰지 않는다(300체 이상에서 바디·충돌 비용이 크고, 필요한 건 원형 근접 판정뿐).
 */
export class EnemySystem {
  readonly pool: Pool<Enemy>;
  readonly grid = new SpatialHash<Enemy>(64);
  stage = 1;
  /** 위협 등급(뉴게임+ 회차, D38): 체력·공격·밀도 배율 */
  threat = 0;
  /** 포위망(D35): 스폰 밀도 배율, 1보다 크면 각도를 고르게(사방을 둘러쌈) */
  encircle = 1;
  private ringStep = 0;
  /** 대규모 군집 대기열(상한이 차면 남은 수는 자리가 날 때) */
  private burstQueue: BurstJob[] = [];
  /** 장애물(서울 시가전 등): 있으면 밀어내고 벽을 따라 미끄러진다 */
  blocker: { resolve(x: number, y: number, r: number): { x: number; y: number; nx: number; ny: number } } | null = null;
  level = 1;
  /** 스트레스 모드: 동시 개체를 cfg.stress로 채움 */
  stress = false;
  /** 지금 스폰 표·밀도 배율·동시 상한(스테이지 진행이 바꾼다) */
  spawns: ReadonlyArray<{ enemy: string; perSec: number }> = [];
  spawnMult = 1;
  maxAliveNormal = 160;
  private readonly acc = new Map<string, number>();
  private readonly anims = new Map<EnemyId, UnitAnims>();
  private readonly spawnR = spawnRadius(LOGICAL_WIDTH, LOGICAL_HEIGHT, 0);
  private readonly rand = (): number => this.rng.next();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: SpawnConfig,
    private readonly rng: Rng,
  ) {
    this.pool = new Pool(() => new Enemy(scene), cfg.poolSize);
  }

  setSpawns(spawns: ReadonlyArray<{ enemy: string; perSec: number }>, mult: number): void {
    if (spawns !== this.spawns) for (const s of spawns) if (!isEnemyId(s.enemy)) throw new Error(`unknown enemy in spawn table: ${s.enemy}`);
    this.spawns = spawns;
    this.spawnMult = mult;
  }

  get alive(): number {
    return this.pool.size;
  }

  private animsFor(id: EnemyId): UnitAnims {
    let a = this.anims.get(id);
    if (!a) {
      a = registerUnitAnims(this.scene, id);
      this.anims.set(id, a);
    }
    return a;
  }

  private get maxAlive(): number {
    return this.stress ? this.cfg.stress : this.maxAliveNormal;
  }

  /** force: 상한을 넘어도 등장(엘리트·보스) */
  spawn(id: EnemyId, x: number, y: number, nowMs: number, force = false): Enemy | null {
    if (!force && this.pool.size >= this.maxAlive) return null;
    const e = this.pool.acquire();
    e.spawn(id, this.animsFor(id), x, y, enemyScale(this.stage, this.level, this.threat), this.rng, nowMs);
    return e;
  }

  /** 플레이어 주변 화면 밖 원형 위치에 스폰 */
  spawnAround(id: EnemyId, target: Target, nowMs: number, force = false): Enemy | null {
    // 포위망이면 황금각으로 돌아가며 사방에 고르게(가장자리 가중), 아니면 무작위
    const angle = this.encircle > 1 ? (this.ringStep++ * 2.39996) % (Math.PI * 2) : this.rng.next() * Math.PI * 2;
    const p = ringPoint(target.x, target.y, this.spawnR + this.cfg.radiusMargin * (1 + this.rng.next()), angle);
    const lead = this.spawn(id, p.x, p.y, nowMs, force);
    // 무리(group): 같은 자리 주변에 함께 나옴(돌격대 집단 돌진). 상한이면 거기까지
    const g = lead ? (lead.def as { group?: { count: number[]; spread: number } }).group : undefined;
    if (lead && g) {
      const [lo = 1, hi = lo] = g.count;
      const n = lo + Math.floor(this.rng.next() * (hi - lo + 1));
      for (let i = 1; i < n; i++) {
        const a = this.rng.next() * Math.PI * 2;
        const r = g.spread * (0.4 + 0.6 * this.rng.next());
        if (!this.spawn(id, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, nowMs, force)) break;
      }
    }
    return lead;
  }

  /** 스트레스 모드를 켜면 즉시 상한까지 채운다 */
  setStress(on: boolean, target: Target, nowMs: number): void {
    this.stress = on;
    if (!on) return;
    const ids = this.spawns.map((s) => s.enemy as EnemyId);
    while (this.pool.size < this.maxAlive) {
      if (!this.spawnAround(this.rng.pick(ids), target, nowMs)) break;
    }
  }

  update(dtMs: number, nowMs: number, timeScale: number, target: Target, cam: Phaser.Cameras.Scene2D.Camera, hooks?: AttackHooks, minTelegraphMs = 600): void {
    if (dtMs > 0) this.spawnTick(dtMs, target, nowMs);
    const list = this.pool.active;
    const despawnR = (this.spawnR + this.cfg.radiusMargin * 2) * this.cfg.despawnFactor;
    const ctx = { targetX: target.x, targetY: target.y };

    // 1) 이동
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i] as Enemy;
      const frozen = nowMs < e.freezeUntilMs;
      if (e.kb.ms > 0 && !frozen) {
        const k = stepKnockback(e.kb, dtMs);
        e.setPosition(e.x + k.dx, e.y + k.dy);
      }
      if (dtMs > 0 && nowMs >= e.stunUntilMs) {
        e.ageMs += dtMs;
        // 공격 2층: 단계 상태기계가 이동 방식(자유·제자리·돌진)을 정한다
        let mode = 'free';
        if (e.attacks.length > 0) {
          const evs = stepAttack(e.atk, e.attacks, dtMs, { x: e.x, y: e.y, targetX: target.x, targetY: target.y, sinceHurtMs: nowMs - e.lastHurtMs, rand: this.rand }, minTelegraphMs);
          for (const ev of evs) hooks?.onAttack(e, ev, nowMs);
          mode = moveMode(e.atk, e.attacks);
        }
        const dir = mode === 'free' ? steer(e, e.behaviors, ctx) : mode === 'dash' ? { x: e.atk.dirX, y: e.atk.dirY } : { x: 0, y: 0 };
        // 빙판 가속(E46, 지형): 계속 움직이면 최대 max배까지, 멈추거나 경직되면 처음부터
        const ice = (e.def as { iceAccel?: { max: number; perSec: number } }).iceAccel;
        if (ice) e.iceMul = mode === 'free' && (dir.x !== 0 || dir.y !== 0) ? Math.min(ice.max, e.iceMul + (ice.perSec * dtMs) / 1000) : 1;
        const speed = mode === 'dash' ? (e.attacks[e.atk.index]?.speed ?? e.speed) : e.speed * e.iceMul;
        e.contactMult = mode === 'dash' ? (e.attacks[e.atk.index]?.damage ?? 1) : 1;
        const d = (speed * dtMs) / 1000;
        e.setPosition(e.x + dir.x * d, e.y + dir.y * d);
        if (this.blocker && !e.air) {
          // 길찾기 없이: 밀어내고, 막히면 벽 법선에 수직(목표 쪽)으로 미끄러짐
          const r = this.blocker.resolve(e.x, e.y, e.radius);
          if (r.nx !== 0 || r.ny !== 0) {
            const s = slideDir(dir.x, dir.y, r.nx, r.ny, target.x - e.x, target.y - e.y);
            const q = this.blocker.resolve(r.x + s.x * d, r.y + s.y * d, e.radius);
            e.setPosition(q.x, q.y);
          }
        }
        // 제자리 공격 중에는 목표 쪽을 본다
        const face = mode === 'hold' ? target.x - e.x : dir.x;
        if (face < -0.05) e.sprite.setFlipX(true);
        else if (face > 0.05) e.sprite.setFlipX(false);
        // 출격 시간(공중 유닛 lifeMs): 지나면 이탈(처치 아님, 경험치 없음)
        const life = (e.def as { lifeMs?: number }).lifeMs;
        if (life !== undefined && e.ageMs > life) {
          e.despawn();
          this.pool.release(e);
          continue;
        }
        // 너무 멀어진 적은 화면 밖 반대편으로 재배치(개체 수 유지, 뒤처진 적이 영영 안 오는 문제 방지)
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (dx * dx + dy * dy > despawnR * despawnR) {
          const p = ringPoint(target.x, target.y, this.spawnR + this.cfg.radiusMargin, Math.atan2(-dy, -dx) + (this.rng.next() - 0.5));
          e.setPosition(p.x, p.y);
        }
      }
      e.updateAnim(true, nowMs, frozen ? 0 : timeScale);
      // 은신(산악 침투병 등): 플레이어와 멀면 거의 투명·자동 조준 제외
      const stealth = (e.def as { stealth?: { distance: number; alpha: number } }).stealth;
      if (stealth) {
        const far = (e.x - target.x) ** 2 + (e.y - target.y) ** 2 > stealth.distance * stealth.distance;
        if (far !== e.hidden) {
          e.hidden = far;
          e.sprite.setAlpha(far ? stealth.alpha : 1);
        }
      }
    }

    // 2) 공간 해시 다시 채우기
    this.grid.clear();
    for (const e of list) this.grid.insert(e);

    // 3) 겹침 완화: 같은·인접 칸 이웃만, 개체당 검사 수 상한. 서로 절반씩 밀어낸다(쌍을 양쪽에서 한 번씩 보므로)
    if (dtMs > 0) {
      const maxChecks = this.cfg.separationChecks;
      for (const e of list) {
        let checks = 0;
        let px = 0;
        let py = 0;
        if (e.air) continue;
        this.grid.forEachNear(e.x, e.y, e.radius + MAX_ENEMY_RADIUS, (n, d2) => {
          if (n === e || n.air) return;
          const minD = e.radius + n.radius;
          if (d2 < minD * minD) {
            const d = Math.sqrt(d2) || 0.01;
            const push = (minD - d) * 0.5;
            px += ((e.x - n.x) / d) * push;
            py += ((e.y - n.y) / d) * push;
          }
          return ++checks >= maxChecks;
        });
        // 플레이어와는 겹치지 않게 적만 밀려난다
        const tx = e.x - target.x;
        const ty = e.y - target.y;
        const minP = e.radius + target.radius;
        const tp2 = tx * tx + ty * ty;
        if (tp2 < minP * minP) {
          const d = Math.sqrt(tp2) || 0.01;
          px += (tx / d) * (minP - d);
          py += (ty / d) * (minP - d);
        }
        if (px !== 0 || py !== 0) {
          // 밀려서 장애물에 들어가지 않게
          const q = this.blocker ? this.blocker.resolve(e.x + px, e.y + py, e.radius) : { x: e.x + px, y: e.y + py };
          e.setPosition(q.x, q.y);
        }
      }
    }

    // 3.5) 오라(E28 정치보위요원): 반경 안 다른 적 공격·이동 배율(겹치면 가장 큰 값 하나)
    this.applyAuras(list);

    // 4) 화면 위아래 순서(아래쪽이 앞)
    for (const e of list) e.sprite.setDepth((e.air ? Depth.Air : Depth.Unit) + (e.y - cam.scrollY) * 0.001);
  }

  /** 지금 적 체력 배율(스테이지·레벨, 바리케이드 체력 등에 씀) */
  scaleHp(): number {
    return enemyScale(this.stage, this.level, this.threat).hp;
  }

  private applyAuras(list: readonly Enemy[]): void {
    const src = list.filter((e) => e.alive && (e.def as { aura?: unknown }).aura);
    for (const e of list) {
      let atk = 1;
      let spd = 1;
      for (const s of src) {
        if (s === e) continue;
        const a = (s.def as unknown as { aura: { radius: number; attackMul: number; speedMul: number } }).aura;
        if ((s.x - e.x) ** 2 + (s.y - e.y) ** 2 > a.radius * a.radius) continue;
        atk = Math.max(atk, a.attackMul);
        spd = Math.max(spd, a.speedMul);
      }
      e.attack = e.baseAttack * atk;
      e.speed = e.baseSpeed * spd;
      e.buffed = atk > 1 || spd > 1;
    }
  }

  /** 대규모 군집(D33): 한쪽 원호에서 count체 */
  burst(id: string, count: number, arcDeg: number): void {
    this.burstQueue.push({ id, left: count, angle: this.rng.next() * Math.PI * 2, arcRad: (arcDeg * Math.PI) / 180 });
  }

  get burstPending(): number {
    return this.burstQueue.reduce((n, j) => n + j.left, 0);
  }

  private countOf(id: string): number {
    let n = 0;
    for (const e of this.pool.active) if (e.alive && e.id === id) n++;
    return n;
  }

  private spawnTick(dtMs: number, target: Target, nowMs: number): void {
    if (this.burstQueue.length > 0) {
      const r = takeBurst(this.burstQueue, this.maxAlive - this.pool.size);
      this.burstQueue = r.queue;
      for (const s of r.spawn) {
        const p = ringPoint(target.x, target.y, this.spawnR + this.cfg.radiusMargin, s.angle + (this.rng.next() - 0.5) * s.arcRad);
        if (isEnemyId(s.id)) this.spawn(s.id, p.x, p.y, nowMs);
      }
    }
    const density = enemyScale(this.stage, this.level, this.threat).density * this.spawnMult * this.encircle;
    for (const s of this.spawns) {
      const r = accumulate(this.acc.get(s.enemy) ?? 0, s.perSec * density, dtMs);
      this.acc.set(s.enemy, r.acc);
      const cap = r.count > 0 ? TYPE_CAP[s.enemy] : undefined;
      if (cap !== undefined && this.countOf(s.enemy) >= cap) {
        this.acc.set(s.enemy, 0);
        continue;
      }
      for (let i = 0; i < r.count; i++) {
        if (!this.spawnAround(s.enemy as EnemyId, target, nowMs)) {
          this.acc.set(s.enemy, 0); // 상한이면 누적하지 않는다(상한이 풀릴 때 한꺼번에 쏟아지지 않게)
          break;
        }
      }
    }
  }

  /** 적 하나 회수(처치) */
  kill(e: Enemy): void {
    if (!e.alive) return;
    e.despawn();
    this.pool.release(e);
  }

  /** 모든 적 회수(재시작용) */
  clear(): void {
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i] as Enemy;
      e.despawn();
      this.pool.release(e);
    }
  }
}
