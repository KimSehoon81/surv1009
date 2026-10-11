import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import spawnData from '../data/spawn.json';
import combat from '../data/combat.json';
import feelData from '../data/feel.json';
import { createRng, type Rng } from '../core/rng';
import { computeHit } from '../core/combat';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Depth } from '../config/depth';
import { params } from '../config/params';
import { GameClock } from '../systems/clock';
import { DebugOverlay } from '../systems/debugOverlay';
import { EnemySystem } from '../systems/enemies';
import { Feel } from '../systems/feel';
import { Floor, type FloorConfig } from '../systems/floor';
import { FxSystem } from '../systems/fx';
import { InputMap } from '../systems/input';
import { PickupSystem } from '../systems/pickups';
import { ProjectileSystem, type ProjectileHooks } from '../systems/projectiles';
import { WeaponSystem, isWeaponId, type WeaponHooks } from '../systems/weapons';
import { Player, isCharacterId, type CharacterId } from '../entities/Player';
import type { Enemy } from '../entities/Enemy';
import { SceneKey } from './keys';

const CHARACTERS: CharacterId[] = ['A01', 'A02', 'A03'];
const DEBUG_SLOW = 0.4;
const HIT = { blockK: combat.blockK, blockReduction: combat.blockReduction, maxBlockChance: combat.maxBlockChance };

/** 전투 씬: 플레이어·적·무기·투사체·경험치·피격·전사. 시간은 전부 전투 시계(clock) 기준 */
export class BattleScene extends Phaser.Scene {
  readonly clock = new GameClock();
  private controls!: InputMap;
  player!: Player;
  private floor!: Floor;
  enemies!: EnemySystem;
  private weapons!: WeaponSystem;
  private projectiles!: ProjectileSystem;
  private pickups!: PickupSystem;
  private fx!: FxSystem;
  private feel!: Feel;
  private combatRng!: Rng;
  private hpBar!: Phaser.GameObjects.Graphics;
  private debug!: DebugOverlay;
  private pauseText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;
  /** 이번 판 기록 */
  readonly run = { xp: 0, kills: 0, damageTaken: 0, blocks: 0, defeated: false };
  private invincible = false;
  private hooks!: ProjectileHooks;
  private weaponHooks!: WeaponHooks;

  constructor() {
    super(SceneKey.Battle);
  }

  create(): void {
    this.clock.reset();
    Object.assign(this.run, { xp: 0, kills: 0, damageTaken: 0, blocks: 0, defeated: false });
    const rng = createRng(params.seed);
    this.combatRng = rng.fork('combat');
    this.controls = new InputMap(this);
    this.floor = new Floor(this, floorData.S1 satisfies FloorConfig, params.seed);

    const start: CharacterId = isCharacterId(params.char) ? params.char : 'A01';
    this.player = new Player(this, 0, 0, start);
    this.enemies = new EnemySystem(this, spawnData.S1, rng.fork('enemies'));
    this.projectiles = new ProjectileSystem(this, combat.bodyOffsetY);
    this.pickups = new PickupSystem(this, {
      cap: combat.pickupCap,
      collectRadius: combat.collectRadius,
      pullSpeed: combat.magnetPullSpeed,
      accel: combat.magnetAccel,
    });
    this.fx = new FxSystem(this, feelData.fxCap);
    this.feel = new Feel(this, this.clock, this.fx, rng.fork('feel'));
    this.weapons = new WeaponSystem();
    this.equipStartingWeapons();
    this.hooks = {
      onHit: (e, mult, dx, dy) => this.damageEnemy(e, mult, dx, dy),
      onLand: (x, y, radius, mult, fxName, fxScale) => this.explode(x, y, radius, mult, fxName, fxScale),
    };

    this.weaponHooks = { onFire: (x, y, facing) => this.feel.muzzle(x, y, facing, this.player.y) };

    this.hpBar = this.add.graphics().setDepth(Depth.Ui - 1);
    this.cameras.main.startFollow(this.player.sprite, true);
    this.cameras.main.centerOn(0, 0);

    const textStyle = {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      align: 'center',
      backgroundColor: '#000000b0',
      padding: { x: 12, y: 8 },
    };
    this.pauseText = this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, '일시정지\nEsc로 계속', textStyle);
    this.bannerText = this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, '', textStyle);
    for (const t of [this.pauseText, this.bannerText]) t.setOrigin(0.5).setScrollFactor(0).setDepth(Depth.Ui).setVisible(false);

    this.debug = new DebugOverlay(this, this.clock, params.debug, () => {
      const p = this.player;
      return [
        `player ${p.id} ${p.action} hp ${p.hp}/${p.maxHp} (${Math.round(p.x)}, ${Math.round(p.y)})${this.invincible ? ' [무적]' : ''}`,
        `enemies ${this.enemies.alive}${this.enemies.stress ? ' [STRESS]' : ''} pool ${this.enemies.pool.capacity} (created ${this.enemies.pool.created})`,
        `weapons ${this.weapons.equipped.map((w) => w.id).join(',')} shots ${this.projectiles.active} fx ${this.fx.active}`,
        `xp ${this.run.xp} kills ${this.run.kills} gems ${this.pickups.active} taken ${this.run.damageTaken} blocks ${this.run.blocks}`,
        `feel particles ${this.feel.particles.active}/${this.feel.particles.cap} numbers ${this.feel.numbers.active} combo ${this.feel.combo.count}`,
        params.debug ? 'J공격 K방어 L스킬 U치명 O느림 C캐릭터 V수류탄 I무적 B대형처치 F2적300 Esc정지' : '',
      ].filter(Boolean);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.controls.destroy();
      this.floor.destroy();
    });
  }

  private equipStartingWeapons(): void {
    for (const id of this.player.weapons) if (isWeaponId(id)) this.weapons.add(id);
  }

  override update(time: number, delta: number): void {
    if (this.controls.justDown('pause') && !this.run.defeated) this.togglePause();
    const dt = this.clock.tick(delta);
    const now = this.clock.timeMs;
    const scale = this.clock.scale;
    const p = this.player;
    if (params.debug && !this.clock.hasScale('pause')) this.debugKeys(now);

    p.update(this.controls, dt, now, scale);
    const cam = this.cameras.main;
    // 플레이어는 늘 적보다 앞(포위돼도 위치가 보이게, PRD §6.4 가독성). 적끼리는 y 순서
    p.sprite.setDepth(Depth.Player);
    const target = { x: p.x, y: p.y, radius: combat.playerRadius };
    this.enemies.update(dt, now, scale, target, cam);
    if (!this.run.defeated) {
      this.weapons.update(dt, now, p, this.enemies.grid, this.projectiles, this.weaponHooks);
      this.projectiles.update(dt, this.enemies.grid, this.hooks);
      this.contactDamage(now);
      this.run.xp += this.pickups.update(dt, p.x, p.y, p.stats.magnet);
    }
    this.fx.update(this.clock.effectScale);
    this.feel.update(time, this.clock.effectDeltaMs);
    // 피격 무적 중 깜빡임
    p.sprite.setAlpha(now < p.invulnUntilMs && Math.floor(now / 80) % 2 === 0 ? 0.45 : 1);
    this.drawHpBar();
    this.floor.update(cam);
    this.debug.update(delta);
    this.controls.endFrame();
  }

  /** 투사체·폭발이 적을 맞혔을 때(PRD §4.3: 0.15초 경직, §4.4: 타격감). (dirX, dirY)는 타격 방향 */
  private damageEnemy(e: Enemy, damageMult: number, dirX: number, dirY: number): void {
    if (!e.alive) return;
    const now = this.clock.timeMs;
    const s = this.player.stats;
    const res = computeHit(
      { attack: s.attack * damageMult, critChance: s.critChance, critMult: s.critMult, defense: e.def.defense, ...HIT },
      this.combatRng,
    );
    e.hp -= res.damage;
    const bodyY = e.y - combat.bodyOffsetY;
    this.feel.hit(res.crit ? 'crit' : 'normal', e.x, bodyY, {
      sprite: e.sprite,
      knockback: e.kb,
      tier: e.def.tier,
      dirX,
      dirY,
      amount: res.damage,
      groundY: e.y,
    });
    if (res.crit) this.player.trigger('crit', now);
    if (e.hp <= 0) {
      this.finishEnemy(e);
      return;
    }
    e.stunUntilMs = now + combat.enemyHitStunMs;
    e.trigger('hit', now);
  }

  /** 처치: 보급품 + 등급별 처치 연출(일반 kill, 정예·보스 kill_big) */
  private finishEnemy(e: Enemy, tier: string = e.def.tier): void {
    this.pickups.drop(e.x, e.y, e.def.xp, this.clock.timeMs);
    this.feel.kill(tier, e.x, e.y - combat.bodyOffsetY, { groundY: e.y });
    this.feel.forget(e.sprite);
    this.enemies.kill(e);
    this.run.kills++;
  }

  /** 곡사 착지: 범위 안 모든 적에게 피해 + 폭발 이펙트 */
  private explode(x: number, y: number, radius: number, mult: number, fxName: string | undefined, fxScale: number): void {
    if (fxName) this.fx.play(fxName, x, y - combat.bodyOffsetY * 0.4, fxScale);
    const hit: Enemy[] = [];
    this.enemies.grid.forEachNear(x, y, radius + 24, (e, d2) => {
      const r = radius + e.radius;
      if (e.alive && d2 <= r * r) hit.push(e);
    });
    for (const e of hit) this.damageEnemy(e, mult, e.x - x, e.y - y);
  }

  /** 적과 몸이 닿으면 피해. 무적 시간 동안은 다시 맞지 않는다. 방어 판정 성공 시 −50% + 방어 동작 */
  private contactDamage(now: number): void {
    const p = this.player;
    if (now < p.invulnUntilMs || this.invincible) return;
    let attacker: Enemy | null = null;
    this.enemies.grid.forEachNear(p.x, p.y, combat.playerRadius + 26, (e, d2) => {
      const r = combat.playerRadius + e.radius + 2;
      if (e.alive && d2 <= r * r) {
        attacker = e;
        return true;
      }
    });
    if (!attacker) return;
    const e = attacker as Enemy;
    const res = computeHit({ attack: e.attack, critChance: 0, critMult: 1, defense: p.stats.defense, ...HIT }, this.combatRng);
    p.hp = Math.max(0, p.hp - res.damage);
    p.invulnUntilMs = now + combat.playerInvulnMs;
    this.run.damageTaken += res.damage;
    this.feel.flash(p.sprite, res.blocked ? 0x9fc4ff : 0xff4040, combat.playerHurtFlashMs);
    this.feel.hit(res.blocked ? 'block' : 'player_hit', p.x, p.y - combat.bodyOffsetY, { amount: res.damage, groundY: p.y });
    if (res.blocked) {
      this.run.blocks++;
      p.trigger('defend', now);
    }
    if (p.hp <= 0) this.defeat();
  }

  /** 전사: 전투 정지 → 잠시 후 재시작(결과 화면은 D13) */
  private defeat(): void {
    this.run.defeated = true;
    this.clock.pause('defeat');
    this.bannerText.setText(`전사\n처치 ${this.run.kills} · 경험치 ${this.run.xp}\n잠시 후 다시 출정`).setVisible(true);
    this.time.delayedCall(combat.defeatRestartMs, () => this.scene.restart());
  }

  private drawHpBar(): void {
    const p = this.player;
    const g = this.hpBar.clear();
    const w = 30;
    const x = Math.round(p.x - w / 2);
    const y = Math.round(p.y + 4);
    g.fillStyle(0x2a1a10, 1).fillRect(x - 1, y - 1, w + 2, 5);
    g.fillStyle(0x5a2020, 1).fillRect(x, y, w, 3);
    g.fillStyle(p.hp / p.maxHp > 0.3 ? 0x6fd06f : 0xff5040, 1).fillRect(x, y, Math.round((w * p.hp) / p.maxHp), 3);
  }

  private togglePause(): void {
    if (this.clock.hasScale('pause')) this.clock.resume('pause');
    else this.clock.pause('pause');
    this.pauseText.setVisible(this.clock.hasScale('pause'));
  }

  private debugKeys(now: number): void {
    const p = this.player;
    if (this.controls.justDown('debugAttack')) p.trigger('attack', now);
    if (this.controls.justDown('debugDefend')) p.trigger('defend', now);
    if (this.controls.justDown('debugSkill')) p.trigger('skill', now);
    if (this.controls.justDown('debugCrit')) p.trigger('crit', now);
    if (this.controls.justDown('debugSlow')) p.speedMul = p.speedMul < 1 ? 1 : DEBUG_SLOW;
    if (this.controls.justDown('debugInvincible')) this.invincible = !this.invincible;
    if (this.controls.justDown('debugWeapon')) {
      if (this.weapons.has('grenade')) this.weapons.remove('grenade');
      else this.weapons.add('grenade');
    }
    if (this.controls.justDown('debugBigKill')) {
      // 정예·보스가 아직 없으므로 가장 가까운 적을 대형 처치 연출로 쓰러뜨려 kill_big 프리셋을 확인
      const e = this.enemies.grid.nearest(p.x, p.y, 600, (n) => n.alive);
      if (e) this.finishEnemy(e, 'boss');
    }
    if (this.controls.justDown('debugStress')) {
      this.enemies.setStress(!this.enemies.stress, { x: p.x, y: p.y, radius: combat.playerRadius }, now);
    }
    if (this.controls.justDown('debugCharacter')) {
      const next = CHARACTERS[(CHARACTERS.indexOf(p.id) + 1) % CHARACTERS.length] as CharacterId;
      p.setCharacter(next, now);
    }
  }
}
