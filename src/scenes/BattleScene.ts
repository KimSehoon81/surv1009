import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import spawnData from '../data/spawn.json';
import combat from '../data/combat.json';
import feelData from '../data/feel.json';
import levels from '../data/levels.json';
import upgradesData from '../data/upgrades.json';
import cardsData from '../data/cards.json';
import { createRng, type Rng } from '../core/rng';
import { computeHit } from '../core/combat';
import { parseColor } from '../core/feel';
import { Progression, type UpgradeTarget } from '../core/progression';
import type { RarityConfig, UpgradeDef } from '../core/upgrades';
import { xpToNext } from '../core/xp';
import { Depth } from '../config/depth';
import { params } from '../config/params';
import { GameClock } from '../systems/clock';
import { DebugOverlay } from '../systems/debugOverlay';
import { EnemySystem } from '../systems/enemies';
import { AudioSystem } from '../systems/audio';
import { CARD_DATA, CardSystem } from '../systems/cards';
import { EffectRunner } from '../systems/effectRunner';
import { TIMELINES, TimelineSystem } from '../systems/timeline';
import { runEffect, type Params } from '../systems/effects';
import type { CardEvent } from '../core/cards';
import { Feel } from '../systems/feel';
import { Floor, type FloorConfig } from '../systems/floor';
import { FxSystem } from '../systems/fx';
import { InputMap } from '../systems/input';
import { PickupSystem } from '../systems/pickups';
import { ProjectileSystem, type ProjectileHooks } from '../systems/projectiles';
import { WeaponSystem, isWeaponId, type WeaponHooks } from '../systems/weapons';
import { Player, isCharacterId, type CharacterId } from '../entities/Player';
import { MAX_ENEMY_RADIUS, type Enemy } from '../entities/Enemy';
import { SceneKey } from './keys';

const CHARACTERS: CharacterId[] = ['A01', 'A02', 'A03'];
const DEBUG_SLOW = 0.4;
const RESIDUE = cardsData.failResidue as Record<string, { effect: string; params: Params }>;
/** 통신 복구가 풀 수 있는 디버프 = 마이너스 카드가 거는 버프 */
const DEBUFF_IDS = new Set(
  Object.values(CARD_DATA.cards)
    .filter((c) => c.tag === 'minus' && typeof c.params.id === 'string')
    .map((c) => c.params.id as string),
);
const CARD_IDS = Object.keys(CARD_DATA.cards);
const TIMELINE_IDS = Object.keys(TIMELINES);
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
  feel!: Feel;
  /** 레벨·업그레이드(HUD 씬이 읽음) */
  progression!: Progression;
  /** 화면 가운데 큰 알림(전사 등). null이면 없음 */
  bannerMessage: string | null = null;
  private upgradeTarget!: UpgradeTarget;
  audio!: AudioSystem;
  /** 전략카드(손패·판정). HUD 씬이 그린다 */
  cards!: CardSystem;
  /** 작전판(Tab) 열림: 전투 완전 정지 */
  opsOpen = false;
  private combatRng!: Rng;
  private hpBar!: Phaser.GameObjects.Graphics;
  private debug!: DebugOverlay;
  /** 이번 판 기록 */
  readonly run = { xp: 0, kills: 0, damageTaken: 0, blocks: 0, defeated: false, tp: 0, comboSuccesses: 0 };
  /** 카드 효과 실행기(예약·예고 마커 포함) */
  effects!: EffectRunner;
  /** 조합·고급 스킬 연출 타임라인 */
  timelines!: TimelineSystem;
  private debugComboIndex = 0;
  /** 콤보 보급: 다음 문턱 번호, 최근 보급 시각(전투 시계) */
  private comboDrawStep = 0;
  private comboDrawTimes: number[] = [];
  private lastComboCount = 0;
  private debugCardIndex = 0;
  private invincible = false;
  private hooks!: ProjectileHooks;
  private weaponHooks!: WeaponHooks;

  constructor() {
    super(SceneKey.Battle);
  }

  create(): void {
    this.clock.reset();
    Object.assign(this.run, { xp: 0, kills: 0, damageTaken: 0, blocks: 0, defeated: false, tp: 0, comboSuccesses: 0 });
    this.comboDrawStep = 0;
    this.comboDrawTimes = [];
    this.lastComboCount = 0;
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
      maxSpeedMul: combat.magnetMaxSpeedMul,
      minSpeedMul: combat.magnetMinSpeedMul,
    });
    this.fx = new FxSystem(this, feelData.fxCap);
    this.feel = new Feel(this, this.clock, this.fx, rng.fork('feel'));
    this.audio = new AudioSystem(this, rng.fork('audio'));
    this.feel.setAudio(this.audio);
    const battle = this;
    this.cards = new CardSystem(
      {
        clock: this.clock,
        audio: this.audio,
        stats: () => battle.player.stats,
        stage: () => 1,
        sealOpReduction: () => Math.round(battle.player.stats.sealOpReduction),
        canAct: () => !battle.run.defeated && !battle.progression.isOpen && !battle.clock.hasScale('pause') && !battle.opsOpen,
        onResult: (success) => battle.feel.hit(success ? 'card_success' : 'card_fail', battle.player.x, battle.player.y - combat.bodyOffsetY),
        onEffect: (ev) => {
          battle.events.emit('cards:effect', ev);
          battle.onCardEvent(ev);
        },
      },
      rng.fork('cards'),
    );
    this.weapons = new WeaponSystem();
    this.equipStartingWeapons();
    this.hooks = {
      onHit: (e, mult, dx, dy) => this.damageEnemy(e, mult, dx, dy),
      onLand: (x, y, radius, mult, fxName, fxScale, impact) => this.explode(x, y, radius, mult, fxName, fxScale, impact),
    };

    this.weaponHooks = { onFire: (x, y, facing) => this.feel.muzzle(x, y, facing, this.player.y) };

    this.hpBar = this.add.graphics().setDepth(Depth.Ui - 1);
    this.cameras.main.startFollow(this.player.sprite, true);
    this.cameras.main.centerOn(0, 0);

    this.bannerMessage = null;
    this.progression = new Progression(
      {
        xp: levels.xp,
        rarity: upgradesData.rarity as unknown as RarityConfig,
        upgrades: upgradesData.upgrades as unknown as UpgradeDef[],
        fallbacks: upgradesData.fallbacks as unknown as UpgradeDef[],
        rerolls: levels.rerolls,
      },
      rng.fork('upgrades'),
    );
    this.effects = new EffectRunner({
      scene: this,
      clock: this.clock,
      player: this.player,
      enemies: this.enemies,
      projectiles: this.projectiles,
      feel: this.feel,
      audio: this.audio,
      cards: this.cards,
      progression: this.progression,
      rng: rng.fork('effects'),
      explode: (x, y, r, m, f, fs, imp) => this.explode(x, y, r, m, f, fs, imp),
      damageEnemy: (e, m, dx, dy, aoe) => this.damageEnemy(e, m, dx, dy, aoe),
      onPlayerHurt: (n) => {
        this.run.damageTaken += n;
      },
      addTp: (n) => {
        this.run.tp += n;
        this.toast(`TP +${n}`);
      },
      toast: (msg, color) => this.toast(msg, color),
      debuffIds: DEBUFF_IDS,
    });
    this.timelines = new TimelineSystem({
      scene: this,
      clock: this.clock,
      fx: this.fx,
      feel: this.feel,
      audio: this.audio,
      effects: this.effects,
      grid: this.enemies.grid,
      player: this.player,
      rng: rng.fork('timelines'),
      damage: (x, y, r, m) => this.explode(x, y, r, m, undefined, 1, undefined),
    });
    const scene = this;
    this.upgradeTarget = {
      get luck() {
        return scene.player.stats.luck;
      },
      get weapons() {
        return scene.weapons.equipped.map((w) => w.id);
      },
      addPlayerMods: (mods) => this.player.addMods(mods),
      addWeaponMods: (id, mods) => this.weapons.addMods(id, mods),
      addWeapon: (id) => {
        if (isWeaponId(id)) this.weapons.add(id);
      },
      heal: (f) => {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + Math.round(this.player.maxHp * f));
      },
      pullAll: () => this.pickups.attractAll(),
    };

    this.debug = new DebugOverlay(this, this.clock, params.debug, () => {
      const p = this.player;
      return [
        `player ${p.id} ${p.action} hp ${p.hp}/${p.maxHp} (${Math.round(p.x)}, ${Math.round(p.y)})${this.invincible ? ' [무적]' : ''}`,
        `enemies ${this.enemies.alive}${this.enemies.stress ? ' [STRESS]' : ''} pool ${this.enemies.pool.capacity} (created ${this.enemies.pool.created})`,
        `weapons ${this.weapons.equipped.map((w) => w.id).join(',')} shots ${this.projectiles.active} fx ${this.fx.active}`,
        `cards hand ${this.cards.state.hand.map((c) => c.id).join(',')} sel ${this.cards.selected.length} op ${this.cards.state.op} seals ${this.cards.state.seals} deck ${this.cards.state.drawPile.length}`,
        `lv ${this.progression.level} (${Math.round(this.progression.progress * 100)}%) pending ${this.progression.pending} rerolls ${this.progression.rerolls}`,
        `effects pending ${this.effects.pending} timelines ${this.timelines.active} buffs ${this.player.buffs.list.map((b) => b.id).join(',') || '-'} tp ${this.run.tp} combos ${this.run.comboSuccesses} tactical ${this.progression.tacticalSlots}`,
        `xp ${this.run.xp} kills ${this.run.kills} gems ${this.pickups.active} taken ${this.run.damageTaken} blocks ${this.run.blocks}`,
        `feel particles ${this.feel.particles.active}/${this.feel.particles.cap} numbers ${this.feel.numbers.active} combo ${this.feel.combo.count}`,
        `audio ${this.audio.enabled ? `voices ${this.audio.activeVoices} played ${this.audio.played} dropped ${this.audio.dropped}` : 'off'}`,
        params.debug ? 'J공격 K방어 L스킬 U치명 O느림 C캐릭터 V수류탄 I무적 B대형처치 N레벨업 F2적300 F3카드 F4조합 Esc정지' : '',
      ].filter(Boolean);
    });

    // 창·탭을 벗어나면 자동 일시정지(돌아왔을 때 이미 맞고 있지 않게)
    const autoPause = () => {
      if (!this.run.defeated && !this.clock.hasScale('pause')) this.togglePause();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, autoPause);
    this.game.events.on(Phaser.Core.Events.HIDDEN, autoPause);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, autoPause);
      this.game.events.off(Phaser.Core.Events.HIDDEN, autoPause);
      this.controls.destroy();
      this.floor.destroy();
      this.audio.destroy();
      this.scene.stop(SceneKey.Hud);
    });
    this.scene.launch(SceneKey.Hud);
  }

  private equipStartingWeapons(): void {
    for (const id of this.player.weapons) if (isWeaponId(id)) this.weapons.add(id);
  }

  override update(time: number, delta: number): void {
    if (this.controls.justDown('pause') && !this.run.defeated && !this.progression.isOpen && !this.opsOpen) this.togglePause();
    const dt = this.clock.tick(delta);
    this.feel.beginFrame(delta, this.clock.hardPaused);
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
      // 경험치 배율(전공 훈장 등)은 주울 때 곱한다
      const gained = this.pickups.update(dt, p.x, p.y, p.stats.magnet) * p.stats.xpMul;
      if (gained > 0) {
        this.audio.play('pickup');
        this.progression.addXp(gained);
      }
      this.run.xp += gained;
      if (this.progression.pending > 0 && !this.progression.isOpen) this.openLevelUp();
      this.cards.update(dt, time);
      this.effects.update();
      this.timelines.update();
      this.comboSupply(now);
    }
    this.fx.update(this.clock.effectScale);
    this.feel.update(this.clock.effectDeltaMs);
    this.audio.update({ paused: this.clock.hardPaused, slowmo: this.clock.hasScale('slowmo'), judge: this.clock.hasScale('judge') }, cam.midPoint.x, cam.midPoint.y);
    // 피격 무적 중 깜빡임
    p.sprite.setAlpha(now < p.invulnUntilMs && Math.floor(now / combat.invulnBlinkMs) % 2 === 0 ? combat.invulnBlinkAlpha : 1);
    this.drawHpBar();
    this.floor.update(cam);
    this.debug.update(delta);
    this.controls.endFrame();
  }

  /**
   * 투사체·폭발이 적을 맞혔을 때(PRD §4.3: 0.15초 경직, §4.4: 타격감). (dirX, dirY)는 타격 방향.
   * aoe(범위 공격)는 중심 연출을 explode가 한 번만 내고, 맞은 적마다는 가벼운 프리셋(aoe_hit)을 쓴다.
   */
  private damageEnemy(e: Enemy, damageMult: number, dirX: number, dirY: number, aoe = false): void {
    if (!e.alive) return;
    const now = this.clock.timeMs;
    const s = this.player.stats;
    const res = computeHit(
      { attack: s.attack * damageMult, critChance: s.critChance, critMult: s.critMult, defense: e.def.defense, ...HIT },
      this.combatRng,
    );
    e.hp -= res.damage;
    const preset = res.crit ? (aoe ? 'aoe_crit' : 'crit') : aoe ? 'aoe_hit' : 'normal';
    this.feel.hit(preset, e.x, e.y - combat.bodyOffsetY, { target: e, dirX, dirY, amount: res.damage, groundY: e.y });
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

  /** 판정이 끝난 카드 결과를 효과로(PRD §5.1·§5.3.1). 조합 스킬 전용 연출(D10~D11) 전에는 쓰인 카드 효과를 배수로 대신 낸다 */
  private onCardEvent(ev: CardEvent): void {
    if (ev.type === 'cardEffect') this.runCard(ev.card.id, 1);
    else if (ev.type === 'minusTriggered') this.runCard(ev.card.id, ev.mult);
    else if (ev.type === 'lost') {
      const tag = CARD_DATA.cards[ev.card.id]?.tag ?? '';
      const r = RESIDUE[tag];
      if (r) runEffect(r.effect, this.effects, r.params, 1);
    } else if (ev.type === 'comboSkill') {
      const s = this.player.stats;
      // 연출 타임라인이 있는 조합은 그것으로, 아직 없는 조합(D11)은 쓰인 카드 효과를 배수로 대신
      this.effects.schedule(s.comboDelayMs, () => {
        if (this.timelines.play(ev.combo, s.comboPower)) return;
        const power = cardsData.comboFallbackPower * s.comboPower;
        for (const c of ev.cards) if (CARD_DATA.cards[c.id]?.tag !== 'minus') this.runCard(c.id, power);
      });
      this.run.comboSuccesses++;
      if (this.run.comboSuccesses % levels.tacticalEvery === 0) {
        this.progression.tacticalSlots++;
        this.toast('전술 선택지 확보 (다음 레벨업)', '#7fd8ff');
      }
    }
  }

  private runCard(id: string, power: number): void {
    const def = CARD_DATA.cards[id];
    if (def) runEffect(def.effect, this.effects, def.params, power);
  }

  private toast(msg: string, color?: string): void {
    this.events.emit('toast', msg, color);
  }

  /** 콤보 보급(G4): 콤보가 문턱(25·60·120)을 넘을 때 카드 1장(가득이면 OP +1), 1분에 최대 perMinute번 */
  private comboSupply(now: number): void {
    const cfg = levels.comboDraw;
    const n = this.feel.combo.count;
    if (n < this.lastComboCount) this.comboDrawStep = 0;
    this.lastComboCount = n;
    const next = cfg.thresholds[this.comboDrawStep];
    if (next === undefined || n < next) return;
    this.comboDrawStep++;
    this.comboDrawTimes = this.comboDrawTimes.filter((t) => now - t < 60_000);
    if (this.comboDrawTimes.length >= cfg.perMinute) return;
    this.comboDrawTimes.push(now);
    const evs = this.cards.act({ type: 'drawNow' });
    this.toast(evs.some((e) => e.type === 'drawn') ? `${next} 콤보 보급: 카드 +1` : `${next} 콤보 보급: OP +1`, '#ffe14d');
  }

  /** 곡사 착지·카드 포격: 범위 안 모든 적에게 피해 + 폭발 이펙트(mult 0이면 연출만) */
  private explode(x: number, y: number, radius: number, mult: number, fxName: string | undefined, fxScale: number, impact: string | undefined): void {
    const cy = y - combat.bodyOffsetY * 0.4;
    if (fxName) this.fx.play(fxName, x, cy, fxScale);
    if (impact) this.feel.hit(impact, x, cy, { groundY: y });
    if (mult <= 0 || radius <= 0) return;
    const hit: Enemy[] = [];
    this.enemies.grid.forEachNear(x, y, radius + MAX_ENEMY_RADIUS, (e, d2) => {
      const r = radius + e.radius;
      if (e.alive && d2 <= r * r) hit.push(e);
    });
    for (const e of hit) this.damageEnemy(e, mult, e.x - x, e.y - y, true);
  }

  /** 적과 몸이 닿으면 피해. 무적 시간 동안은 다시 맞지 않는다. 방어 판정 성공 시 −50% + 방어 동작 */
  private contactDamage(now: number): void {
    const p = this.player;
    if (now < p.invulnUntilMs || this.invincible) return;
    let attacker: Enemy | null = null;
    this.enemies.grid.forEachNear(p.x, p.y, combat.playerRadius + MAX_ENEMY_RADIUS + combat.contactSlackPx, (e, d2) => {
      const r = combat.playerRadius + e.radius + combat.contactSlackPx;
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
    this.feel.flash(p.sprite, parseColor(res.blocked ? feelData.playerFlash.block : feelData.playerFlash.hurt), combat.playerHurtFlashMs);
    this.feel.hit(res.blocked ? 'block' : 'player_hit', p.x, p.y - combat.bodyOffsetY, {
      amount: res.damage,
      groundY: p.y,
      dirX: p.x - e.x,
      dirY: p.y - e.y,
    });
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
    this.bannerMessage = `전사\nLv ${this.progression.level} · 처치 ${this.run.kills} · 경험치 ${this.run.xp}\n잠시 후 다시 출정`;
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
  }

  /** 작전판(Tab): 전투를 완전히 멈추고 조합표·확률 내역을 본다 */
  setOpsBoard(on: boolean): void {
    this.opsOpen = on;
    if (on) this.clock.pause('ops');
    else this.clock.resume('ops');
  }

  canOpenBoard(): boolean {
    return !this.run.defeated && !this.progression.isOpen && !this.clock.hasScale('pause');
  }

  /** 레벨업 창 열기: 전투 시계만 멈추고(HUD는 계속) 선택지를 HUD로 보낸다 */
  private openLevelUp(): void {
    const choices = this.progression.open(this.upgradeTarget);
    if (!choices) return;
    this.clock.pause('levelup');
    this.events.emit('levelup', choices);
    this.audio.play('levelup');
  }

  /** HUD에서 고른 업그레이드 적용. 레벨업이 더 쌓여 있으면 다음 프레임에 다시 열린다 */
  pickUpgrade(index: number): void {
    if (!this.progression.choose(index, this.upgradeTarget)) return;
    this.audio.play('select');
    this.clock.resume('levelup');
    this.events.emit('levelupClosed');
  }

  rerollUpgrade(): void {
    if (!this.progression.reroll() || !this.progression.choices) return;
    this.audio.play('select');
    this.events.emit('levelup', this.progression.choices);
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
    if (this.controls.justDown('debugLevel')) this.progression.addXp(xpToNext(this.progression.level, levels.xp) - this.progression.xp.xp);
    if (this.controls.justDown('debugBigKill')) {
      // 정예·보스가 아직 없으므로 가장 가까운 적을 대형 처치 연출로 쓰러뜨려 kill_big 프리셋을 확인
      const e = this.enemies.grid.nearest(p.x, p.y, 600, (n) => n.alive);
      if (e) this.finishEnemy(e, 'boss');
    }
    if (this.controls.justDown('debugCard')) {
      // 카탈로그 순서대로 한 장씩 지급(P01 → … → M08 → P01)
      const id = CARD_IDS[this.debugCardIndex % CARD_IDS.length] as string;
      this.debugCardIndex++;
      this.cards.give(id);
      this.toast(`[디버그] ${id} ${CARD_DATA.cards[id]?.name ?? ''} 지급`, '#b0a890');
    }
    if (this.controls.justDown('debugCombo')) {
      // 연출이 있는 조합을 차례로 강제 성공(판정 없이 조합 스킬 이벤트만)
      const combo = TIMELINE_IDS[this.debugComboIndex % TIMELINE_IDS.length] as string;
      this.debugComboIndex++;
      const ev: CardEvent = { type: 'comboSkill', combo, cards: [] };
      this.events.emit('cards:effect', ev);
      this.onCardEvent(ev);
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
