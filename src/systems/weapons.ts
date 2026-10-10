import weaponData from '../data/weapons.json';
import type { SpatialHash } from '../core/spatialHash';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { ProjectileSystem } from './projectiles';

export type WeaponId = keyof typeof weaponData.weapons;
type WeaponDef = (typeof weaponData.weapons)[WeaponId];

export function isWeaponId(id: string): id is WeaponId {
  return id in weaponData.weapons;
}

interface Equipped {
  id: WeaponId;
  def: WeaponDef;
  /** 0 이하면 발사 가능 */
  cooldownMs: number;
}

const num = (def: WeaponDef, key: string): number | undefined => {
  const v = (def as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
};

/** 장착 무기: 쿨다운마다 사거리 안 가장 가까운 적을 자동 조준해 발사(PRD §6.1 기본 무기 자동) */
export class WeaponSystem {
  readonly equipped: Equipped[] = [];

  add(id: WeaponId): void {
    if (this.equipped.some((w) => w.id === id)) return;
    this.equipped.push({ id, def: weaponData.weapons[id], cooldownMs: 0 });
  }

  has(id: WeaponId): boolean {
    return this.equipped.some((w) => w.id === id);
  }

  remove(id: WeaponId): void {
    const i = this.equipped.findIndex((w) => w.id === id);
    if (i >= 0) this.equipped.splice(i, 1);
  }

  update(dtMs: number, nowMs: number, player: Player, grid: SpatialHash<Enemy>, projectiles: ProjectileSystem): void {
    if (dtMs <= 0) return;
    const stats = player.stats;
    for (const w of this.equipped) {
      w.cooldownMs -= dtMs;
      if (w.cooldownMs > 0) continue;
      const range = num(w.def, 'range') ?? stats.range;
      const target = grid.nearest(player.x, player.y, range, (e) => e.alive);
      if (!target) {
        w.cooldownMs = 0; // 적이 없으면 장전 상태로 대기(여러 발이 쌓이지 않게)
        continue;
      }
      const cooldown = num(w.def, 'cooldownMs') ?? 1000 / stats.attackSpeed;
      w.cooldownMs += cooldown;
      player.faceTowards(target.x);
      if (w.def.type === 'projectile') {
        const muzzleX = player.x + player.facing * 12;
        projectiles.fireBullet(
          {
            sprite: w.def.sprite,
            scale: w.def.scale,
            speed: num(w.def, 'projectileSpeed') ?? 400,
            radius: num(w.def, 'radius') ?? 4,
            pierce: num(w.def, 'pierce') ?? 0,
            damageMult: w.def.damageMult,
            rangePx: range,
          },
          muzzleX,
          player.y,
          target.x,
          target.y,
        );
        player.fireAnim(nowMs);
      } else if (w.def.type === 'lob') {
        const def = w.def as Record<string, unknown>;
        projectiles.lob(
          {
            sprite: w.def.sprite,
            scale: w.def.scale,
            flightMs: num(w.def, 'flightMs') ?? 600,
            arcHeight: num(w.def, 'arcHeight') ?? 40,
            aoeRadius: num(w.def, 'aoeRadius') ?? 40,
            damageMult: w.def.damageMult,
            fx: typeof def.fx === 'string' ? def.fx : undefined,
            fxScale: num(w.def, 'fxScale') ?? 1,
          },
          player.x,
          player.y,
          target.x,
          target.y,
        );
      }
    }
  }
}
