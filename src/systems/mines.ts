import type * as Phaser from 'phaser';
import { manifest } from '../assets/manifest';
import { Pool } from '../core/pool';
import type { SpatialHash } from '../core/spatialHash';
import { Depth } from '../config/depth';
import { MAX_ENEMY_RADIUS, type Enemy } from '../entities/Enemy';

/** 진영: ally 지뢰는 적이 밟으면, enemy 지뢰(D23)는 플레이어가 밟으면 터진다 */
export type Faction = 'ally' | 'enemy';

export interface MineSpec {
  faction: Faction;
  /** 설치 후 이 시간 뒤부터 반응 */
  armMs: number;
  lifeMs: number;
  /** 밟힘 판정 반경 / 폭발 피해 반경 px */
  triggerRadius: number;
  radius: number;
  /** 공격력 배수(ally) 또는 최대 체력 비율(enemy) */
  damage: number;
  scale: number;
}

interface Mine {
  sprite: Phaser.GameObjects.Sprite;
  spec: MineSpec;
  x: number;
  y: number;
  bornMs: number;
}

export interface MineHooks {
  /** 터짐: 연출·피해는 호출부(전투)가 */
  onExplode(x: number, y: number, spec: MineSpec): void;
}

/** 시트 mines: 0 낙하, 1~2 설치 점멸, 3~5 폭발(폭발은 FxSystem이 3프레임부터 재생) */
const SHEET = 'mines';
const BLINK_MS = 400;

/** 지뢰 엔티티(풀). 조합 '지뢰 살포'와 적 지뢰가 진영만 바꿔 같이 쓴다 */
export class MineSystem {
  private readonly pool: Pool<Mine>;

  constructor(
    scene: Phaser.Scene,
    private readonly cap: number,
  ) {
    this.pool = new Pool<Mine>(
      () => ({
        sprite: scene.add.sprite(0, 0, '__DEFAULT').setActive(false).setVisible(false),
        spec: { faction: 'ally', armMs: 0, lifeMs: 0, triggerRadius: 0, radius: 0, damage: 0, scale: 1 },
        x: 0,
        y: 0,
        bornMs: 0,
      }),
      8,
    );
  }

  get active(): number {
    return this.pool.size;
  }

  /** 상한을 넘으면 가장 오래된 지뢰부터 없앤다 */
  place(x: number, y: number, spec: MineSpec, nowMs: number): void {
    if (this.pool.size >= this.cap) {
      const oldest = this.pool.active[0];
      if (oldest) this.release(oldest);
    }
    const m = this.pool.acquire();
    m.spec = spec;
    m.x = x;
    m.y = y;
    m.bornMs = nowMs;
    m.sprite
      .setTexture(manifest.fx(SHEET).key, 0)
      .setPosition(x, y)
      .setOrigin(0.5, 0.75)
      .setScale(spec.scale)
      .setDepth(Depth.Decal + 2)
      .setAlpha(1)
      .setTint(spec.faction === 'enemy' ? 0xffb0a0 : 0xffffff)
      .setActive(true)
      .setVisible(true);
  }

  update(nowMs: number, grid: SpatialHash<Enemy>, player: { x: number; y: number; radius: number }, hooks: MineHooks): void {
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i] as Mine;
      const age = nowMs - m.bornMs;
      if (age >= m.spec.lifeMs) {
        this.release(m);
        continue;
      }
      // 낙하 프레임 → 설치 점멸(남은 수명 2초부터 빠르게)
      const blink = m.spec.lifeMs - age < 2000 ? BLINK_MS / 3 : BLINK_MS;
      m.sprite.setFrame(age < m.spec.armMs ? 0 : 1 + (Math.floor(age / blink) % 2));
      if (age < m.spec.armMs) continue;
      if (this.triggered(m, grid, player)) {
        this.release(m);
        hooks.onExplode(m.x, m.y, m.spec);
      }
    }
  }

  private triggered(m: Mine, grid: SpatialHash<Enemy>, player: { x: number; y: number; radius: number }): boolean {
    const r = m.spec.triggerRadius;
    if (m.spec.faction === 'enemy') return (player.x - m.x) ** 2 + (player.y - m.y) ** 2 <= (r + player.radius) ** 2;
    let hit = false;
    grid.forEachNear(m.x, m.y, r + MAX_ENEMY_RADIUS, (e, d2) => {
      const rr = r + e.radius;
      if (e.alive && d2 <= rr * rr) {
        hit = true;
        return true;
      }
    });
    return hit;
  }

  private release(m: Mine): void {
    m.sprite.setActive(false).setVisible(false);
    this.pool.release(m);
  }
}
