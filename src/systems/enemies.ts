import type * as Phaser from 'phaser';
import { Pool } from '../core/pool';
import { SpatialHash } from '../core/spatialHash';
import { steer } from '../core/behaviors';
import { stepKnockback } from '../core/feel';
import { enemyScale } from '../core/scaling';
import { accumulate, ringPoint, spawnRadius } from '../core/spawnLogic';
import type { Rng } from '../core/rng';
import { Depth } from '../config/depth';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Enemy, isEnemyId, type EnemyId } from '../entities/Enemy';
import { registerUnitAnims, type UnitAnims } from './anims';

export interface SpawnConfig {
  maxAlive: number;
  spawns: ReadonlyArray<{ enemy: string; perSec: number }>;
  radiusMargin: number;
  despawnFactor: number;
  separationChecks: number;
  poolSize: number;
  stress: number;
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
  level = 1;
  /** 스트레스 모드: 동시 개체를 cfg.stress로 채움 */
  stress = false;
  private readonly acc = new Map<string, number>();
  private readonly anims = new Map<EnemyId, UnitAnims>();
  private readonly spawnR = spawnRadius(LOGICAL_WIDTH, LOGICAL_HEIGHT, 0);

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: SpawnConfig,
    private readonly rng: Rng,
  ) {
    this.pool = new Pool(() => new Enemy(scene), cfg.poolSize);
    for (const s of cfg.spawns) if (!isEnemyId(s.enemy)) throw new Error(`스폰 표의 알 수 없는 적: ${s.enemy}`);
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
    return this.stress ? this.cfg.stress : this.cfg.maxAlive;
  }

  spawn(id: EnemyId, x: number, y: number, nowMs: number): Enemy | null {
    if (this.pool.size >= this.maxAlive) return null;
    const e = this.pool.acquire();
    e.spawn(id, this.animsFor(id), x, y, enemyScale(this.stage, this.level), this.rng, nowMs);
    return e;
  }

  /** 플레이어 주변 화면 밖 원형 위치에 스폰 */
  spawnAround(id: EnemyId, target: Target, nowMs: number): Enemy | null {
    const p = ringPoint(target.x, target.y, this.spawnR + this.cfg.radiusMargin * (1 + this.rng.next()), this.rng.next() * Math.PI * 2);
    return this.spawn(id, p.x, p.y, nowMs);
  }

  /** 스트레스 모드를 켜면 즉시 상한까지 채운다 */
  setStress(on: boolean, target: Target, nowMs: number): void {
    this.stress = on;
    if (!on) return;
    const ids = this.cfg.spawns.map((s) => s.enemy as EnemyId);
    while (this.pool.size < this.maxAlive) {
      if (!this.spawnAround(this.rng.pick(ids), target, nowMs)) break;
    }
  }

  update(dtMs: number, nowMs: number, timeScale: number, target: Target, cam: Phaser.Cameras.Scene2D.Camera): void {
    if (dtMs > 0) this.spawnTick(dtMs, target, nowMs);
    const list = this.pool.active;
    const despawnR = (this.spawnR + this.cfg.radiusMargin * 2) * this.cfg.despawnFactor;
    const ctx = { targetX: target.x, targetY: target.y };

    // 1) 이동
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i] as Enemy;
      if (e.kb.ms > 0) {
        const k = stepKnockback(e.kb, dtMs);
        e.setPosition(e.x + k.dx, e.y + k.dy);
      }
      if (dtMs > 0 && nowMs >= e.stunUntilMs) {
        e.ageMs += dtMs;
        const dir = steer(e, e.behaviors, ctx);
        const d = (e.speed * dtMs) / 1000;
        e.setPosition(e.x + dir.x * d, e.y + dir.y * d);
        if (dir.x < -0.05) e.sprite.setFlipX(true);
        else if (dir.x > 0.05) e.sprite.setFlipX(false);
        // 너무 멀어진 적은 화면 밖 반대편으로 재배치(개체 수 유지, 뒤처진 적이 영영 안 오는 문제 방지)
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (dx * dx + dy * dy > despawnR * despawnR) {
          const p = ringPoint(target.x, target.y, this.spawnR + this.cfg.radiusMargin, Math.atan2(-dy, -dx) + (this.rng.next() - 0.5));
          e.setPosition(p.x, p.y);
        }
      }
      e.updateAnim(true, nowMs, timeScale);
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
        this.grid.forEachNear(e.x, e.y, e.radius * 2, (n, d2) => {
          if (n === e) return;
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
        if (px !== 0 || py !== 0) e.setPosition(e.x + px, e.y + py);
      }
    }

    // 4) 화면 위아래 순서(아래쪽이 앞)
    for (const e of list) e.sprite.setDepth(Depth.Unit + (e.y - cam.scrollY) * 0.001);
  }

  private spawnTick(dtMs: number, target: Target, nowMs: number): void {
    const density = enemyScale(this.stage, this.level).density;
    for (const s of this.cfg.spawns) {
      const r = accumulate(this.acc.get(s.enemy) ?? 0, s.perSec * density, dtMs);
      this.acc.set(s.enemy, r.acc);
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
