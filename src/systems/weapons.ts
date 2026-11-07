import weaponData from '../data/weapons.json';
import combat from '../data/combat.json';
import type { SpatialHash } from '../core/spatialHash';
import { modValue, type StatMod } from '../core/stats';
import type { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import type { ExplodeSpec, ProjectileSystem } from './projectiles';

const DEFAULTS = weaponData.defaults;

export interface WeaponHooks {
  /** 총알 발사 순간. (x, y): 총구 끝 월드 좌표 */
  onFire?(x: number, y: number, facing: number): void;
  /** 오라: (x, y) 둘레 radius 안 적 전부 */
  onAura?(x: number, y: number, radius: number, damageMult: number): void;
  /** 설치형: (x, y)에 지뢰 */
  onPlace?(x: number, y: number, damageMult: number, mine: { armMs: number; lifeMs: number; triggerRadius: number; radius: number; scale: number }): void;
  /** 근접 휘두르기: (dirX, dirY) 방향 arcDeg 부채꼴 radius 안 모두 타격 */
  onMelee?(x: number, y: number, dirX: number, dirY: number, radius: number, arcDeg: number, damageMult: number, knockback: number): void;
}

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
  /** 무기 강화 수정자(damageMult·aoeRadius 등) */
  mods: StatMod[];
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
    this.equipped.push({ id, def: weaponData.weapons[id], cooldownMs: 0, mods: [] });
  }

  /** 무기 강화(레벨업). 장착하지 않은 무기면 무시 */
  addMods(id: string, mods: readonly StatMod[]): void {
    const w = this.equipped.find((e) => e.id === id);
    if (w) w.mods.push(...mods);
  }

  /** 정의값(없으면 기본값)에 강화 수정자를 적용한 값 */
  private param(w: Equipped, key: string, fallback: number): number {
    return modValue(num(w.def, key) ?? fallback, key, w.mods);
  }

  has(id: WeaponId): boolean {
    return this.equipped.some((w) => w.id === id);
  }

  remove(id: WeaponId): void {
    const i = this.equipped.findIndex((w) => w.id === id);
    if (i >= 0) this.equipped.splice(i, 1);
  }

  /** 모든 장착 무기에서 빼기(캐릭터 교체) */
  clear(): void {
    this.equipped.length = 0;
  }

  /** prefer: 사거리 안에 있으면 먼저 노릴 적(자동 조준 '위협 우선', G6) */
  update(dtMs: number, nowMs: number, player: Player, grid: SpatialHash<Enemy>, projectiles: ProjectileSystem, hooks: WeaponHooks = {}, prefer?: (e: Enemy) => boolean): void {
    if (dtMs <= 0) return;
    const stats = player.stats;
    for (const w of this.equipped) {
      w.cooldownMs -= dtMs;
      if (w.cooldownMs > 0) continue;
      const range = this.param(w, 'range', stats.range);
      const target = (prefer && grid.nearest(player.x, player.y, range, (e) => e.alive && prefer(e))) || grid.nearest(player.x, player.y, range, (e) => e.alive);
      if (!target) {
        w.cooldownMs = 0; // 적이 없으면 장전 상태로 대기(여러 발이 쌓이지 않게)
        continue;
      }
      const cooldown = this.param(w, 'cooldownMs', 1000 / stats.attackSpeed);
      w.cooldownMs += cooldown;
      player.faceTowards(target.x);
      const def = w.def as Record<string, unknown>;
      if (w.def.type === 'aura') {
        hooks.onAura?.(player.x, player.y, this.param(w, 'auraRadius', 64), this.param(w, 'damageMult', 1));
      } else if (w.def.type === 'placeable') {
        // 목표 쪽으로 조금 앞에 설치(적이 지나갈 자리)
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const len = Math.hypot(dx, dy) || 1;
        const ahead = Math.min(48, len / 2);
        hooks.onPlace?.(player.x + (dx / len) * ahead, player.y + (dy / len) * ahead, this.param(w, 'damageMult', 1), def.mine as { armMs: number; lifeMs: number; triggerRadius: number; radius: number; scale: number });
        player.fireAnim(nowMs);
      } else if (w.def.type === 'melee') {
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const len = Math.hypot(dx, dy) || 1;
        hooks.onMelee?.(player.x, player.y, dx / len, dy / len, this.param(w, 'meleeRadius', range), this.param(w, 'arcDeg', 120), this.param(w, 'damageMult', 1), this.param(w, 'knockback', 0));
        player.fireAnim(nowMs);
      } else if (w.def.type === 'projectile') {
        // 총구 끝(발 기준 오프셋). 총알은 총구 높이에서 나가 목표 몸통으로 향한다(발 기준 좌표로 환산해 전달)
        const muzzleX = player.x + player.facing * combat.muzzleOffsetX;
        const muzzleY = player.y + combat.muzzleOffsetY;
        // shots발을 spreadDeg 부채꼴로(기관총), 기본 1발
        const shots = Math.max(1, Math.round(this.param(w, 'shots', 1)));
        const spread = (this.param(w, 'spreadDeg', 0) * Math.PI) / 180;
        const base = Math.atan2(target.y - (muzzleY + combat.bodyOffsetY), target.x - muzzleX);
        const dist = Math.hypot(target.x - muzzleX, target.y - (muzzleY + combat.bodyOffsetY));
        for (let k = 0; k < shots; k++) {
          const a = base + (shots > 1 ? spread * (k / (shots - 1) - 0.5) : 0);
          projectiles.fireBullet(
            {
              sprite: typeof def.sprite === 'string' ? def.sprite : 'bullet',
              scale: num(w.def, 'scale') ?? 0.4,
              speed: this.param(w, 'projectileSpeed', DEFAULTS.projectileSpeed),
              radius: this.param(w, 'radius', DEFAULTS.radius),
              pierce: Math.round(this.param(w, 'pierce', 0)),
              damageMult: this.param(w, 'damageMult', 1),
              rangePx: range,
              ...(def.explode ? { explode: def.explode as ExplodeSpec } : {}),
            },
            muzzleX,
            muzzleY + combat.bodyOffsetY,
            muzzleX + Math.cos(a) * dist,
            muzzleY + combat.bodyOffsetY + Math.sin(a) * dist,
          );
        }
        player.fireAnim(nowMs);
        hooks.onFire?.(muzzleX, muzzleY, player.facing);
      } else if (w.def.type === 'lob') {
        projectiles.lob(
          {
            sprite: typeof def.sprite === 'string' ? def.sprite : 'bullet',
            scale: num(w.def, 'scale') ?? 0.4,
            flightMs: this.param(w, 'flightMs', DEFAULTS.flightMs),
            arcHeight: this.param(w, 'arcHeight', DEFAULTS.arcHeight),
            aoeRadius: this.param(w, 'aoeRadius', DEFAULTS.aoeRadius),
            damageMult: this.param(w, 'damageMult', 1),
            fx: typeof def.fx === 'string' ? def.fx : undefined,
            fxScale: num(w.def, 'fxScale') ?? 1,
            impact: typeof def.impact === 'string' ? def.impact : undefined,
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
