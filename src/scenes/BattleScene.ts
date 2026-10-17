import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import spawnData from '../data/spawn.json';
import combat from '../data/combat.json';
import feelData from '../data/feel.json';
import levels from '../data/levels.json';
import upgradesData from '../data/upgrades.json';
import cardsData from '../data/cards.json';
import skillsData from '../data/skills.json';
import stagesData from '../data/stages.json';
import metaData from '../data/meta.json';
import { StageDirector, type StageDef, type StageEvent } from '../core/stage';
import { Disruptions } from '../core/disruptions';
import { actualRate, defeatTip, meritPoints, type RunRecord } from '../core/results';
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
import { MineSystem } from '../systems/mines';
import { EnemyAttackSystem } from '../systems/enemyAttacks';
import { SkillSlots, type CastReject, type SkillDef } from '../core/skills';
import { damageTakenMult } from '../core/enemyAttack';
import { runEffect, type Params } from '../systems/effects';
import type { CardEvent } from '../core/cards';
import { Feel } from '../systems/feel';
import { Floor, type FloorConfig } from '../systems/floor';
import { FxSystem } from '../systems/fx';
import { InputMap, type InputAction } from '../systems/input';
import { PickupSystem } from '../systems/pickups';
import { ProjectileSystem, type ProjectileHooks } from '../systems/projectiles';
import { WeaponSystem, isWeaponId, type WeaponHooks } from '../systems/weapons';
import { Player, isCharacterId, type CharacterId } from '../entities/Player';
import { MAX_ENEMY_RADIUS, type Enemy, type EnemyId } from '../entities/Enemy';
import enemyData from '../data/enemies.json';
import { manifest } from '../assets/manifest';
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
const TP = skillsData.tp;
const TP_BY_TIER: Record<string, number> = { normal: TP.perKill, elite: TP.perEliteKill, boss: TP.perBossKill };
const SKILL_ACTIONS = skillsData.slots.map((s) => s.action as InputAction);
const STAGES = stagesData.stages as unknown as Record<string, StageDef>;
const DISRUPTION_NAMES: Record<string, string> = { smoke: '포연' };
const CAST_REJECT: Record<CastReject, string> = { locked: '잠긴 슬롯', empty: '장착한 스킬 없음', cooldown: '재사용 대기 중', tp: 'TP 부족', unimplemented: '준비 중인 스킬' };
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
  readonly run = {
    xp: 0,
    kills: 0,
    damageTaken: 0,
    blocks: 0,
    defeated: false,
    captured: false,
    comboSuccesses: 0,
    skillsUsed: 0,
    eliteKills: 0,
    bossKill: false,
    residueDamage: 0,
    lastHitBy: 'contact',
  };
  /** 스테이지 진행(스폰 표·예고·보스)과 방해(HUD가 읽음) */
  stage!: StageDef;
  director!: StageDirector;
  disruptions!: Disruptions;
  /** 살아 있는 보스(HUD 체력바·작전 카드) */
  boss: Enemy | null = null;
  /** 결과 화면에 넘긴 기록(점령·전사 뒤) */
  result: { record: RunRecord; merit: number; tip: string; rate: number } | null = null;
  /** 고급 스킬 슬롯(Q·E·R·F)과 TP. HUD가 읽음 */
  skills!: SkillSlots;
  /** 적 공격 예고·포탄 */
  private enemyAttacks!: EnemyAttackSystem;
  /** 카드 효과 실행기(예약·예고 마커 포함) */
  effects!: EffectRunner;
  /** 조합·고급 스킬 연출 타임라인 */
  timelines!: TimelineSystem;
  /** 지뢰(조합 지뢰 살포, D23 적 지뢰) */
  mines!: MineSystem;
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
    Object.assign(this.run, {
      xp: 0,
      kills: 0,
      damageTaken: 0,
      blocks: 0,
      defeated: false,
      captured: false,
      comboSuccesses: 0,
      skillsUsed: 0,
      eliteKills: 0,
      bossKill: false,
      residueDamage: 0,
      lastHitBy: 'contact',
    });
    this.stage = STAGES[params.stage] ?? (STAGES.S1 as StageDef);
    this.director = new StageDirector(this.stage);
    this.disruptions = new Disruptions(stagesData.rules.maxDisruptions, stagesData.rules.maxCardObscuring);
    this.boss = null;
    this.result = null;
    this.skills = new SkillSlots(
      skillsData.slots.map((sl) => ({ key: sl.key, skillId: sl.equip, locked: !sl.unlocked, readyAtMs: 0 })),
      skillsData.skills as Record<string, SkillDef>,
      TP.max,
    );
    this.skills.addTp(TP.start);
    this.comboDrawStep = 0;
    this.comboDrawTimes = [];
    this.lastComboCount = 0;
    const rng = createRng(params.seed);
    this.combatRng = rng.fork('combat');
    this.controls = new InputMap(this);
    this.floor = new Floor(this, floorData[this.stage.floor as keyof typeof floorData] as FloorConfig, params.seed);

    const start: CharacterId = isCharacterId(params.char) ? params.char : 'A01';
    this.player = new Player(this, 0, 0, start);
    this.enemies = new EnemySystem(this, spawnData.S1, rng.fork('enemies'));
    this.enemies.maxAliveNormal = this.stage.maxAlive;
    const first = this.director.spawnsAt(0);
    this.enemies.setSpawns(first.spawns, first.mult);
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
        canAct: () => !battle.run.defeated && !battle.run.captured && !battle.progression.isOpen && !battle.clock.hasScale('pause') && !battle.opsOpen,
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
      onHit: (e, mult, dx, dy, tag) => this.damageEnemy(e, mult, dx, dy, false, tag),
      onLand: (x, y, radius, mult, fxName, fxScale, impact, tag) => this.explode(x, y, radius, mult, fxName, fxScale, impact, tag),
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
      explode: (x, y, r, m, f, fs, imp, tag) => this.explode(x, y, r, m, f, fs, imp, tag),
      damageEnemy: (e, m, dx, dy, aoe, tag) => this.damageEnemy(e, m, dx, dy, aoe, tag),
      clearStageDisruption: () => {
        const d = this.disruptions.clearOne();
        return d ? (DISRUPTION_NAMES[d.type] ?? d.type) : null;
      },
      onPlayerHurt: (n) => {
        this.run.damageTaken += n;
      },
      addTp: (n) => {
        this.skills.addTp(n);
        this.toast(`TP +${n}`);
      },
      toast: (msg, color) => this.toast(msg, color),
      debuffIds: DEBUFF_IDS,
    });
    this.mines = new MineSystem(this, combat.mineCap);
    this.enemyAttacks = new EnemyAttackSystem(this, {
      feel: this.feel,
      audio: this.audio,
      hitPlayer: (attack, x, y, cause) => this.hitPlayer(attack, x, y, cause),
      player: () => this.player,
      onEvent: (e, ev) => {
        if (ev.type === 'judged' && e === this.boss) this.events.emit('boss:judged', ev.result);
      },
    });
    this.timelines = new TimelineSystem({
      scene: this,
      clock: this.clock,
      fx: this.fx,
      feel: this.feel,
      audio: this.audio,
      effects: this.effects,
      mines: this.mines,
      grid: this.enemies.grid,
      player: this.player,
      rng: rng.fork('timelines'),
      damage: (x, y, r, m) => this.explode(x, y, r, m, undefined, 1, undefined),
      damageEnemy: (e, m, dx, dy) => this.damageEnemy(e, m, dx, dy, true),
      enemiesOnScreen: () => {
        const v = this.cameras.main.worldView;
        return this.enemies.pool.active.filter((e) => e.alive && v.contains(e.x, e.y));
      },
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
        `effects pending ${this.effects.pending} timelines ${this.timelines.active} buffs ${this.player.buffs.list.map((b) => b.id).join(',') || '-'} tp ${Math.round(this.skills.tp)} combos ${this.run.comboSuccesses} tactical ${this.progression.tacticalSlots}`,
        `xp ${this.run.xp} kills ${this.run.kills} gems ${this.pickups.active} taken ${this.run.damageTaken} blocks ${this.run.blocks}`,
        `feel particles ${this.feel.particles.active}/${this.feel.particles.cap} numbers ${this.feel.numbers.active} combo ${this.feel.combo.count}`,
        `audio ${this.audio.enabled ? `voices ${this.audio.activeVoices} played ${this.audio.played} dropped ${this.audio.dropped}` : 'off'}`,
        params.debug ? 'J공격 K방어 L스킬 U치명 O느림 C캐릭터 V수류탄 I무적 B대형처치 N레벨업 F2적300 F3카드 F4조합 F5엘리트 F6가속 Esc정지' : '',
      ].filter(Boolean);
    });

    // 창·탭을 벗어나면 자동 일시정지(돌아왔을 때 이미 맞고 있지 않게)
    const autoPause = () => {
      if (!this.run.defeated && !this.result && !this.clock.hasScale('pause')) this.togglePause();
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
    if (this.controls.justDown('pause') && !this.run.defeated && !this.result && !this.progression.isOpen && !this.opsOpen) this.togglePause();
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
    if (!this.run.defeated && !this.run.captured) this.stageTick(now);
    this.enemies.update(dt, now, scale, target, cam, this.enemyAttacks, combat.minTelegraphMs);
    this.enemyAttacks.update(now, this.enemies.pool.active);
    if (!this.run.defeated && !this.run.captured) {
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
      this.skillInput(now);
      this.effects.update();
      this.timelines.update();
      this.mines.update(now, this.enemies.grid, target, {
        onExplode: (x, y, spec) => {
          this.timelines.cue('mine_blast', x, y);
          if (spec.faction === 'ally') this.explode(x, y, spec.radius, spec.damage, undefined, 1, undefined);
          else this.effects.hurtPlayer(spec.damage, 0);
        },
      });
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
  private damageEnemy(e: Enemy, damageMult: number, dirX: number, dirY: number, aoe = false, tag?: string): void {
    if (!e.alive) return;
    const now = this.clock.timeMs;
    const s = this.player.stats;
    // 방어 자세 −60%, 약점 노출 ×1.5(core/enemyAttack)
    const taken = e.attacks.length > 0 ? damageTakenMult(e.atk, e.attacks) : 1;
    const res = computeHit(
      { attack: s.attack * damageMult * taken, critChance: s.critChance, critMult: s.critMult, defense: e.def.defense, ...HIT },
      this.combatRng,
    );
    e.lastHurtMs = now;
    e.hp -= res.damage;
    if (tag === 'residue') this.run.residueDamage += res.damage;
    // 보스 작전 카드 충전 중 받은 피해(최대 체력 비율) → 일정 이상이면 취소(core/enemyAttack)
    if (e.atk.phase === 'windup') e.atk.chargeDamage += res.damage / e.maxHp;
    const preset = res.crit ? (aoe ? 'aoe_crit' : 'crit') : aoe ? 'aoe_hit' : 'normal';
    this.feel.hit(preset, e.x, e.y - combat.bodyOffsetY, { target: e, dirX, dirY, amount: res.damage, groundY: e.y });
    if (res.crit) this.player.trigger('crit', now);
    if (e.hp <= 0) {
      this.finishEnemy(e);
      return;
    }
    if (!e.staggerImmune) {
      e.stunUntilMs = now + combat.enemyHitStunMs;
      e.trigger('hit', now);
    }
  }

  /** 처치: 보급품 + 등급별 처치 연출(일반 kill, 정예·보스 kill_big) */
  private finishEnemy(e: Enemy, tier: string = e.def.tier): void {
    this.pickups.drop(e.x, e.y, e.def.xp, this.clock.timeMs);
    this.feel.kill(tier, e.x, e.y - combat.bodyOffsetY, { groundY: e.y });
    this.feel.forget(e.sprite);
    this.enemies.kill(e);
    this.run.kills++;
    if (e.def.tier === 'elite') this.run.eliteKills++;
    if (e === this.boss) this.capture(e.x, e.y);
    this.skills.addTp(TP_BY_TIER[e.def.tier] ?? TP.perKill);
  }

  /** 판정이 끝난 카드 결과를 효과로(PRD §5.1·§5.3.1). 조합 스킬 전용 연출(D10~D11) 전에는 쓰인 카드 효과를 배수로 대신 낸다 */
  private onCardEvent(ev: CardEvent): void {
    if (ev.type === 'cardEffect') this.runCard(ev.card.id, 1);
    else if (ev.type === 'minusTriggered') this.runCard(ev.card.id, ev.mult);
    else if (ev.type === 'lost') {
      const tag = CARD_DATA.cards[ev.card.id]?.tag ?? '';
      const r = RESIDUE[tag];
      // 잔효 피해는 정산에 따로 집계(출처 표시를 단 실행기로 감쌈)
      if (r) runEffect(r.effect, Object.create(this.effects, { tag: { value: 'residue' } }) as EffectRunner, r.params, 1);
    } else if (ev.type === 'comboSkill') {
      const s = this.player.stats;
      // 연출 타임라인이 있는 조합은 그것으로, 아직 없는 조합(D11)은 쓰인 카드 효과를 배수로 대신
      this.effects.schedule(s.comboDelayMs, () => {
        if (this.timelines.play(ev.combo, s.comboPower)) return;
        const power = cardsData.comboFallbackPower * s.comboPower;
        for (const c of ev.cards) if (CARD_DATA.cards[c.id]?.tag !== 'minus') this.runCard(c.id, power);
      });
      this.run.comboSuccesses++;
      this.skills.addTp(TP.perComboSuccess);
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
  private explode(x: number, y: number, radius: number, mult: number, fxName: string | undefined, fxScale: number, impact: string | undefined, tag?: string): void {
    const cy = y - combat.bodyOffsetY * 0.4;
    if (fxName) this.fx.play(fxName, x, cy, fxScale);
    if (impact) this.feel.hit(impact, x, cy, { groundY: y });
    if (mult <= 0 || radius <= 0) return;
    const hit: Enemy[] = [];
    this.enemies.grid.forEachNear(x, y, radius + MAX_ENEMY_RADIUS, (e, d2) => {
      const r = radius + e.radius;
      if (e.alive && d2 <= r * r) hit.push(e);
    });
    for (const e of hit) this.damageEnemy(e, mult, e.x - x, e.y - y, true, tag);
  }

  /** 적과 몸이 닿으면 피해. 무적 시간 동안은 다시 맞지 않는다. 방어 판정 성공 시 −50% + 방어 동작 */
  private contactDamage(now: number): void {
    const p = this.player;
    if (now < p.invulnUntilMs || now < p.shieldUntilMs || this.invincible) return;
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
    // 차징 돌진 중이면 접촉 피해 배율
    const kind = e.contactMult > 1 ? 'dash' : 'contact';
    this.hitPlayer(e.attack * e.contactMult, e.x, e.y, e.tier === 'boss' ? `boss:${kind}` : kind);
  }

  /** 적의 공격이 플레이어에게(접촉·포탄). 무적·보호막 중이면 무시, 방어 판정 성공 시 −50% + 방어 동작 */
  private hitPlayer(attack: number, fromX: number, fromY: number, cause: string): void {
    const p = this.player;
    const now = this.clock.timeMs;
    if (this.run.defeated || this.run.captured || now < p.invulnUntilMs || now < p.shieldUntilMs || this.invincible) return;
    this.run.lastHitBy = cause;
    const res = computeHit({ attack, critChance: 0, critMult: 1, defense: p.stats.defense, ...HIT }, this.combatRng);
    p.hp = Math.max(0, p.hp - res.damage);
    p.invulnUntilMs = now + combat.playerInvulnMs;
    this.run.damageTaken += res.damage;
    this.feel.flash(p.sprite, parseColor(res.blocked ? feelData.playerFlash.block : feelData.playerFlash.hurt), combat.playerHurtFlashMs);
    this.feel.hit(res.blocked ? 'block' : 'player_hit', p.x, p.y - combat.bodyOffsetY, {
      amount: res.damage,
      groundY: p.y,
      dirX: p.x - fromX,
      dirY: p.y - fromY,
    });
    if (res.blocked) {
      this.run.blocks++;
      p.trigger('defend', now);
    }
    if (p.hp <= 0) this.defeat();
  }

  /** 고급 스킬 키(Q·E·R·F). 카드 입력과 같은 조건(레벨업·일시정지·작전판 중에는 막힘) */
  private skillInput(now: number): void {
    if (this.progression.isOpen || this.opsOpen || this.run.captured || this.clock.hasScale('pause')) return;
    SKILL_ACTIONS.forEach((a, i) => {
      if (this.controls.justDown(a)) this.castSkill(i, now);
    });
  }

  castSkill(i: number, now = this.clock.timeMs): boolean {
    const r = this.skills.cast(i, now);
    if (!r.ok) {
      this.audio.play('skill_denied');
      this.toast(`${this.skills.slots[i]?.key ?? ''}: ${CAST_REJECT[r.reason]}`, '#b0a890');
      return false;
    }
    this.timelines.play(r.def.timeline as string);
    this.player.trigger('skill', now);
    this.run.skillsUsed++;
    this.toast(`${r.def.name}!`, '#7fd8ff');
    return true;
  }

  /** 전사: 전투 정지 → 잠시 후 재시작(결과 화면은 D13) */
  private defeat(): void {
    this.run.defeated = true;
    this.clock.pause('defeat');
    this.bannerMessage = '전사';
    this.time.delayedCall(combat.defeatResultMs, () => this.showResult(false));
  }

  /** 스테이지 진행: 스폰 표·밀도, 엘리트·방해·보스 예고와 등장 */
  private stageTick(now: number): void {
    const t = now / 1000;
    const view = this.cameras.main.worldView;
    let onScreen = 0;
    for (const e of this.enemies.pool.active) if (e.alive && view.contains(e.x, e.y)) onScreen++;
    for (const ev of this.director.update(t, this.progression.level, { enemiesOnScreen: onScreen })) this.onStageEvent(ev, now);
    const sp = this.director.spawnsAt(t);
    this.enemies.setSpawns(sp.spawns, sp.mult);
    for (const d of this.disruptions.update(t)) this.toast(`${DISRUPTION_NAMES[d.type] ?? d.type} 걷힘`, '#b0a890');
  }

  private onStageEvent(ev: StageEvent, now: number): void {
    const p = this.player;
    const name = (id: string) => (enemyData.enemies as Record<string, { name: string }>)[id]?.name ?? id;
    switch (ev.type) {
      case 'eliteWarn':
        this.events.emit('warn', `${name(ev.enemy)} 접근!`, ev.inSec);
        this.audio.play('debuff');
        break;
      case 'elite':
        this.enemies.spawnAround(ev.enemy as EnemyId, { x: p.x, y: p.y, radius: combat.playerRadius }, now, true);
        break;
      case 'disruptionWarn':
        this.events.emit('warn', `${DISRUPTION_NAMES[ev.def.type] ?? ev.def.type} 예보`, ev.inSec);
        break;
      case 'disruption':
        if (this.disruptions.add(ev.def, now / 1000)) this.toast(`${DISRUPTION_NAMES[ev.def.type] ?? ev.def.type}! 손패가 흐려짐 (통신 복구로 해제)`, '#b0a890');
        break;
      case 'bossWarn':
        this.events.emit('warn', `보스 ${name(ev.enemy)} 출현`, ev.inSec);
        this.audio.play('debuff');
        this.saveCheckpoint();
        break;
      case 'boss': {
        const b = this.enemies.spawnAround(ev.enemy as EnemyId, { x: p.x, y: p.y, radius: combat.playerRadius }, now, true);
        if (b) {
          this.boss = b;
          this.events.emit('boss:spawn', b);
        }
        break;
      }
      case 'pacing':
        this.toast(ev.label, ev.mult > 1 ? '#ff8060' : '#7fd8ff');
        break;
    }
  }

  /** 보스 진입 순간 런 상태 저장(보스 재도전 1회 기반, 재도전 UI는 D19) */
  private saveCheckpoint(): void {
    const data = {
      stage: params.stage,
      char: this.player.id,
      level: this.progression.level,
      timeSec: Math.round(this.clock.timeMs / 1000),
      upgrades: this.progression.history.map((h) => h.id),
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(metaData.checkpointKey, JSON.stringify(data));
    } catch {
      // 저장소가 막힌 환경(시크릿 창 등)에서는 건너뜀
    }
  }

  /** 보스 처치 → 점령: 깃발 + 슬로모, 잠시 뒤 결과 화면 */
  private capture(x: number, y: number): void {
    this.run.captured = true;
    this.run.bossKill = true;
    this.boss = null;
    this.events.emit('boss:dead');
    this.enemies.setSpawns([], 0);
    this.clock.setScale('slowmo', combat.captureSlowmo.scale, combat.captureSlowmo.ms);
    const flag = this.add.image(x, y, manifest.image('ui', 'flag_ally', 32, 32).key).setOrigin(0.5, 1).setScale(0, 2).setDepth(Depth.Player + 5);
    this.tweens.add({ targets: flag, scaleX: 2, duration: 300, ease: 'Back.Out' });
    this.bannerMessage = `${this.stage.name} 점령!`;
    this.audio.play('levelup');
    this.time.delayedCall(combat.captureResultMs, () => this.showResult(true));
  }

  /** 결과 화면: 전투 정지 + 기록·전공 포인트·팁. Enter로 같은 구성 다시 출정 */
  private showResult(victory: boolean): void {
    if (this.result) return;
    const cs = this.cards.state;
    const record: RunRecord = {
      victory,
      timeSec: this.clock.timeMs / 1000,
      level: this.progression.level,
      kills: this.run.kills,
      eliteKills: this.run.eliteKills,
      bossKill: this.run.bossKill,
      submits: cs.stats.submits,
      successes: cs.stats.successes,
      longestFailStreak: cs.stats.longestFailStreak,
      sealsUsed: cs.stats.sealsUsed,
      sealsHeld: cs.seals,
      residueDamage: Math.round(this.run.residueDamage),
      comboSuccesses: this.run.comboSuccesses,
      lastHitBy: this.run.lastHitBy,
    };
    const merit = meritPoints(record, metaData.merit);
    this.result = { record, merit, tip: victory ? '' : defeatTip(record, metaData.tips), rate: actualRate(record) };
    this.clock.pause('result');
    this.bannerMessage = null;
    try {
      const key = metaData.meritKey;
      localStorage.setItem(key, String(Number(localStorage.getItem(key) ?? 0) + merit));
    } catch {
      // 저장 못 해도 결과 화면은 보인다
    }
    this.events.emit('result', this.result);
  }

  /** 다시 출정(같은 구성) */
  redeploy(): void {
    this.scene.restart();
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
    if (this.controls.justDown('debugSpeed')) {
      this.clock.debugSpeed = this.clock.debugSpeed > 1 ? 1 : 8;
      this.toast(`[디버그] 시간 ×${this.clock.debugSpeed}`, '#b0a890');
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
    if (this.controls.justDown('debugElite')) {
      // 원거리·엘리트 확인용: 박격포병 3 + T-34 1을 화면 가장자리 근처에
      for (let i = 0; i < 3; i++) this.enemies.spawn('E03', p.x + Math.cos(i * 2.1) * 300, p.y + Math.sin(i * 2.1) * 220, now);
      this.enemies.spawn('E04', p.x + 320, p.y - 40, now);
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
