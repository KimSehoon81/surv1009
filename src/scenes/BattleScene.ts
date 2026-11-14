import * as Phaser from 'phaser';
import floorData from '../data/floor.json';
import spawnData from '../data/spawn.json';
import combat from '../data/combat.json';
import { createSprint, sprinting, sprintMul, sprintReady, trySprint, type SprintConfig } from '../core/sprint';
import feelData from '../data/feel.json';
import levels from '../data/levels.json';
import upgradesData from '../data/upgrades.json';
import cardsData from '../data/cards.json';
import skillsData from '../data/skills.json';
import stagesData from '../data/stages.json';
import disruptionsData from '../data/disruptions.json';
import metaData from '../data/meta.json';
import { StageDirector, type StageDef, type StageEvent } from '../core/stage';
import { Disruptions } from '../core/disruptions';
import { actualRate, defeatTip, meritPoints, type RunRecord } from '../core/results';
import { createRng, type Rng } from '../core/rng';
import { armorMult, computeHit } from '../core/combat';
import { parseColor, startKnockback } from '../core/feel';
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
import { NpcSystem, type NpcId } from '../systems/npcs';
import { HazardSystem } from '../systems/hazards';
import { ObstacleSystem, type ObstacleConfig } from '../systems/obstacles';
import { PropSystem } from '../systems/props';
import propsData from '../data/props.json';
import type { PropLayout } from '../core/props';
import { loadProfile, updateProfile } from '../systems/save';
import { applyCapture, openSlots, runInit, type StartUpgradeDef, type Unlock, type UnlockEntry } from '../core/meta';
import unlocksData from '../data/unlocks.json';
import type { BattlePayload, MapPayload } from '../types/scenes';
import { PerfMeter } from '../systems/perfMeter';
import { Guide } from '../core/guide';
import guideData from '../data/guide.json';
import npcData from '../data/npcs.json';
import { EnemyAttackSystem } from '../systems/enemyAttacks';
import { SkillSlots, type CastReject, type SkillDef } from '../core/skills';
import { damageTakenMult } from '../core/enemyAttack';
import { runEffect, type Params } from '../systems/effects';
import { SupportSystem } from '../systems/support';
import achievementsData from '../data/achievements.json';
import { addSeen, applyEvent, emptyAchievements, emptyCodex, type AchievementDef, type AchievementState, type Codex, type GameEvent } from '../core/achievements';
import { prefs, qualityPreset, type Prefs } from '../systems/prefs';
import settingsData from '../data/settings.json';
import shopData from '../data/shop.json';
import mapData from '../data/map.json';
import { globalStep, threatReward } from '../core/scaling';
import { buy, type BuyResult, type ShopItem, type ShopState } from '../core/shop';
import { stageNumber, type CardEvent } from '../core/cards';
import { Feel } from '../systems/feel';
import { Floor, type FloorConfig } from '../systems/floor';
import { FxSystem } from '../systems/fx';
import { InputMap, type InputAction } from '../systems/input';
import { PickupSystem } from '../systems/pickups';
import { ProjectileSystem, type ProjectileHooks } from '../systems/projectiles';
import { WeaponSystem, isWeaponId, type WeaponHooks } from '../systems/weapons';
import weaponData from '../data/weapons.json';
import { Player, isCharacterId, isImplemented, passiveOf, type CharacterId, type PassiveDef } from '../entities/Player';
import characterData from '../data/characters.json';
import { MAX_ENEMY_RADIUS, isEnemyId, type Enemy, type EnemyId } from '../entities/Enemy';
import enemyData from '../data/enemies.json';
import { manifest } from '../assets/manifest';
import { SceneKey } from './keys';
import { t } from '../i18n';

const CHARACTERS = Object.keys(characterData.characters).filter(isImplemented);
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
const DEBUG_SETS: [string, number][][] = [
  [['E03', 3], ['E04', 1]],
  [['E06', 4], ['E07', 2], ['E08', 2], ['E09', 1]],
  [['E11', 2], ['E12', 2], ['E13', 3], ['E14', 1]],
  [['E16', 4], ['E17', 2], ['E18', 2], ['E19', 1]],
  [['E21', 5], ['E22', 2], ['E23', 1], ['E24', 1]],
  [['E26', 2], ['E27', 2], ['E28', 1], ['E06', 6], ['E29', 1]],
  [['E31', 12], ['E32', 2], ['E33', 1], ['E34', 1]],
  [['E36', 2], ['E37', 3], ['E38', 2], ['E39', 1]],
  [['E41', 4], ['E42', 3], ['E43', 1], ['E44', 1]],
  [['E46', 6], ['E47', 2], ['E48', 2], ['E49', 1]],
];
const TP = skillsData.tp;
const ACH = achievementsData.achievements as AchievementDef[];
/** 마지막 지역(엔딩): 작전지도 순서의 끝 */
const FINAL_STAGE = mapData.nodes[mapData.nodes.length - 1]?.id ?? 'S10';
/** 위협 우선 조준(G6): 방해원(disrupt)·버프 오라(aura)·지정 우선(targetPriority)·작전 카드 충전 중인 보스(약점) */
const isPriorityTarget = (e: Enemy): boolean => {
  const d = e.def as { disrupt?: unknown; aura?: unknown; targetPriority?: number };
  if (e.atk.phase === 'windup' && e.attacks[e.atk.index]?.type === 'opCard') return true;
  return d.disrupt !== undefined || d.aura !== undefined || d.targetPriority !== undefined;
};
/** 캐릭터 정의 중 능력치 밖 성질(카드 보정·강화·주기 지원·레벨업 보정) */
type CharDef = { cardBonus?: Record<string, number>; cardPower?: Record<string, number>; periodic?: { timeline: string; everyMs: number }; levelUpBonus?: { rarePlusBonus?: number } };
const SHOP_ITEMS = shopData.items as ShopItem[];
const TP_BY_TIER: Record<string, number> = { normal: TP.perKill, elite: TP.perEliteKill, boss: TP.perBossKill };
const SKILL_ACTIONS = skillsData.slots.map((s) => s.action as InputAction);
const STAGES = stagesData.stages as unknown as Record<string, StageDef>;
type DisruptionType = { name: string; category: string; priority: number; hint: string; selectDelayMs?: number; drawMul?: number; blockTags?: string[]; spawnMul?: number; playerSpeedMul?: number; tagPenalty?: Record<string, number>; interactions?: { on: string; tag: string; do: string; ms: number }[] };
const DTYPES = disruptionsData.types as Record<string, DisruptionType>;
const DISRUPTION_NAMES: Record<string, string> = Object.fromEntries(Object.entries(DTYPES).map(([k, v]) => [k, v.name]));
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
  /** 전공 상점 창(N03) */
  shopOpen = false;
  shopState: ShopState | null = null;
  /** 숨은 보급품(N04): 닿으면 효과 */
  private supply: { x: number; y: number; sprite: Phaser.GameObjects.Image } | null = null;
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
  /** 첫 플레이 가이드(상황 발생형 팁) */
  guide!: Guide;
  private npcs!: NpcSystem;
  /** 구간별 프레임 시간(디버그 표시·성능 측정) */
  readonly perf = new PerfMeter();
  /** 살아 있는 보스(HUD 체력바·작전 카드) */
  boss: Enemy | null = null;
  /** 결과 화면에 넘긴 기록(점령·전사 뒤) */
  result: { record: RunRecord; merit: number; tip: string; rate: number; unlocked: Unlock[]; step: number; threat: number; ending: boolean } | null = null;
  /** 고급 스킬 슬롯(Q·E·R·F)과 TP. HUD가 읽음 */
  skills!: SkillSlots;
  /** 적 공격 예고·포탄 */
  private enemyAttacks!: EnemyAttackSystem;
  /** 카드 효과 실행기(예약·예고 마커 포함) */
  effects!: EffectRunner;
  support!: SupportSystem;
  /** 조합·고급 스킬 연출 타임라인 */
  timelines!: TimelineSystem;
  /** 지뢰(조합 지뢰 살포, D23 적 지뢰) */
  mines!: MineSystem;
  /** 피해 장판(화염 등) */
  private hazards!: HazardSystem;
  /** 뒤집힌 카드 방해가 걸려 있는지(바뀌는 순간 손패를 뒤집거나 되돌림) */
  private flipOn = false;
  /** 업적·도감(D41): 이번 판 메모리 상태, 정산 때 저장 */
  private ach: AchievementState = emptyAchievements();
  private codex: Codex = emptyCodex();
  private achMerit = 0;
  private failRun = 0;
  private lastHurtMs = 0;
  private noHitFired = false;
  /** 저사양 자동 하향(D40): FPS가 낮은 채 지난 시간, 이번 판에 이미 낮췄는지 */
  private lowFpsMs = 0;
  private autoLowered = false;
  /** 임시 안전지대(N09 헌병): 안으로 들어온 적을 밀어냄 */
  private safeZone: { x: number; y: number; r: number; untilMs: number; gfx: Phaser.GameObjects.Graphics } | null = null;
  /** explode가 공중 유닛도 맞히는 중(타임라인 피해) */
  private airStrike = false;
  /** 방어 돔(AS10): 끝 시각·감소·반사·반경·색 */
  private dome: { untilMs: number; reduce: number; reflect: number; radius: number; color: number } | null = null;
  private domeGfx: Phaser.GameObjects.Graphics | null = null;
  obstacles!: ObstacleSystem;
  props!: PropSystem;
  /** 설정(전투 시작 때 읽음) */
  pref!: Prefs;
  private debugNpcIndex = 0;
  /** 주기 공중 지원(A29): 다음 실행 시각 */
  private nextPeriodicMs = 0;
  private modalClosedFrame = -1;
  /** 질주(C·패드 왼쪽 스틱): 상태와 먼지·잔상 다음 시각 */
  sprint = createSprint();
  private sprintFxAt = 0;
  private sprintGhostAt = 0;
  private lastInterceptToastMs = -Infinity;
  private debugComboIndex = 0;
  private debugSetIndex = 0;
  /** 콤보 보급: 다음 문턱 번호, 최근 보급 시각(전투 시계) */
  private comboDrawStep = 0;
  private comboDrawTimes: number[] = [];
  private lastComboCount = 0;
  private debugCardIndex = 0;
  private invincible = false;
  private hooks!: ProjectileHooks;
  private weaponHooks!: WeaponHooks;

  /** 이번 판 구성(다시 출정은 같은 값) */
  payload!: BattlePayload;

  constructor() {
    super(SceneKey.Battle);
  }

  init(data: Partial<BattlePayload>): void {
    const char = data.char ?? (isCharacterId(params.char) ? params.char : 'A01');
    this.payload = { stage: data.stage ?? params.stage, char, ...(data.deck ? { deck: data.deck } : {}), ...(data.skills ? { skills: data.skills } : {}) };
  }

  create(): void {
    this.pref = prefs();
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
    this.stage = STAGES[this.payload.stage] ?? (STAGES.S1 as StageDef);
    // 씬은 다시 시작해도 같은 객체: 지난 판의 그리기 객체·목록을 비운다
    this.swingGfx = null;
    this.swings = [];
    this.director = new StageDirector(this.stage);
    this.disruptions = new Disruptions(stagesData.rules.maxDisruptions, stagesData.rules.maxCardObscuring);
    this.boss = null;
    this.result = null;
    this.skills = new SkillSlots(
      // 열린 슬롯은 세이브(해금 스케줄)에서
      skillsData.slots.map((sl) => ({ key: sl.key, skillId: this.payload.skills?.[sl.key] ?? sl.equip, locked: !openSlots(loadProfile()).includes(sl.key), readyAtMs: 0 })),
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

    this.player = new Player(this, 0, 0, this.payload.char);
    this.enemies = new EnemySystem(this, spawnData.S1, rng.fork('enemies'));
    // 난이도 스케일링(PRD §7.3): 스테이지 번호
    this.enemies.stage = stageNumber(this.payload.stage);
    this.enemies.threat = loadProfile().threat ?? 0;
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
      autoAttractMs: combat.pickupAutoAttractMs,
    });
    this.fx = new FxSystem(this, feelData.fxCap);
    this.feel = new Feel(this, this.clock, this.fx, rng.fork('feel'));
    // 흔들림·점멸 강도(설정 0~100%)
    // 이펙트 품질(D40): 입자·숫자 상한, 흔들림 배율
    const qp = qualityPreset(this.pref.quality);
    this.feel.particles.setCap(qp.particles);
    this.feel.numbers.setCap(qp.numbers);
    this.feel.intensity.shake = feelData.intensity.shake * this.pref.feel * qp.shake;
    this.feel.intensity.flash = feelData.intensity.flash * this.pref.feel;
    this.audio = new AudioSystem(this, rng.fork('audio'));
    this.audio.mono = this.pref.mono;
    this.feel.setAudio(this.audio);
    this.audio.playBgm(this.stage.bgm ?? null);
    // 큰 착탄 직전 0.2초 무음(타임라인 훅, PRD §6.2)
    this.events.on('timeline:hook', (hook: string) => {
      if (hook === 'pre_impact_silence') this.audio.silence(200);
    });
    const battle = this;
    this.cards = new CardSystem(
      {
        clock: this.clock,
        audio: this.audio,
        stats: () => battle.player.stats,
        stage: () => stageNumber(battle.payload.stage),
        level: () => (battle.progression ? battle.progression.level : 1), // 카드가 진행도보다 먼저 만들어짐
        sealOpReduction: () => Math.round(battle.player.stats.sealOpReduction),
        canAct: () => !battle.run.defeated && !battle.run.captured && !battle.progression.isOpen && !battle.clock.hasScale('pause') && !battle.modalOpen,
        tagPenalty: () => battle.tagPenalty(),
        tagBonus: () => battle.charDef.cardBonus ?? {},
        drawMul: () => battle.drawMul(),
        blockedTags: () => battle.blockedTags(),
        // 걷어낼 방해·디버프·오보가 없으면 통신 복구는 아껴 둠(Space 두 번이 헛카드를 내지 않게)
        holdCards: () => (battle.effects?.canClearDisruption() ? [] : CARD_DATA.rules.holdWithoutDisruption ?? []),
        onResult: (success, judged) => {
          battle.onJudged(success, judged);
          battle.feel.hit(success ? 'card_success' : 'card_fail', battle.player.x, battle.player.y - combat.bodyOffsetY);
          if (!success) battle.tip('firstFail');
        },
        onEffect: (ev) => {
          battle.events.emit('cards:effect', ev);
          battle.onCardEvent(ev);
        },
      },
      rng.fork('cards'),
      this.payload.deck ?? cardsData.starterDeck,
    );
    this.cards.selectSlowmo = this.pref.selectSlowmo;
    this.cards.judgeMul = this.pref.shortJudge ? settingsData.shortJudgeMul : 1;
    this.cards.autoDiscardMinus = this.pref.autoDiscardMinus;
    this.weapons = new WeaponSystem();
    this.equipStartingWeapons();
    this.hooks = {
      onHit: (e, mult, dx, dy, tag) => this.damageEnemy(e, mult, dx, dy, false, tag),
      // 직선 탄은 장애물에 막힘(바리케이드는 깎임), 곡사·항공은 통과
      blocked: (x, feetY, mult) => {
        const b = this.obstacles.at(x, feetY);
        if (!b) return false;
        this.fx.play('hit_spark', x, feetY - combat.bodyOffsetY, 0.6);
        this.obstacles.damage(b, this.player.stats.attack * mult);
        return true;
      },
      onLand: (x, y, radius, mult, fxName, fxScale, impact, tag) => {
        // 연쇄 수류탄(A25): tag 'cluster:무기' → 둘레에 작은 폭발이 차례로
        const cl = tag?.startsWith('cluster:') ? (weaponData.weapons as Record<string, { cluster?: { count: number; spread: number; radius: number; damageMult: number; delayMs: number } }>)[tag.slice(8)]?.cluster : undefined;
        this.explode(x, y, radius, mult, fxName, fxScale, impact, cl ? undefined : tag);
        if (!cl) return;
        for (let i = 0; i < cl.count; i++) {
          const a = (i / cl.count) * Math.PI * 2 + this.combatRng.next() * 0.6;
          const bx = x + Math.cos(a) * cl.spread;
          const by = y + Math.sin(a) * cl.spread * 0.7;
          this.effects.schedule(cl.delayMs * (i + 1), () => this.explode(bx, by, cl.radius, mult * cl.damageMult, fxName, fxScale * 0.6, 'impact_s'));
        }
      },
    };

    this.weaponHooks = {
      onFire: (x, y, facing) => this.feel.muzzle(x, y, facing, this.player.y),
      onMelee: (x, y, dx, dy, radius, arcDeg, mult, kb) => this.melee(x, y, dx, dy, radius, arcDeg, mult, kb),
      onAura: (x, y, radius, mult, kb = 0) => {
        const hit: Enemy[] = [];
        this.enemies.grid.forEachNear(x, y, radius + MAX_ENEMY_RADIUS, (e, d2) => {
          const r = radius + e.radius;
          if (e.alive && !e.air && d2 <= r * r) hit.push(e);
        });
        for (const e of hit) {
          this.damageEnemy(e, mult, e.x - x, e.y - y, true);
          // 방어 오라(A16): 밀쳐내기
          if (kb > 0 && e.alive) {
            const l = Math.hypot(e.x - x, e.y - y) || 1;
            startKnockback(e.kb, (e.x - x) / l, (e.y - y) / l, kb, 140);
          }
        }
        // 오라 고리 색: 밀쳐내는 방어 오라는 강철색, 의무 오라는 초록
        this.swings.push({ x, y: y - 4, a: 0, half: Math.PI, r: radius / 0.8, until: this.clock.timeMs + 160, color: kb > 0 ? 0x9ab0c8 : 0x6fd06f });
      },
      onPlace: (x, y, mult, mine) => this.mines.place(x, y, { faction: 'ally', ...mine, damage: mult }, this.clock.timeMs),
    };

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
      cutCooldowns: (frac) => this.skills.cutCooldowns(frac, this.clock.timeMs),
      hasStageDisruption: () => this.disruptions.active.length > 0,
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
    // 전투 지원 기믹: 보급 투하·우방군 분대(data/support.json)
    this.support?.destroy();
    this.support = new SupportSystem(this, {
      rng: rng.fork('support'),
      player: () => ({ x: this.player.x, y: this.player.y, facing: this.player.facing }),
      nearestEnemy: (x, y, range) => this.enemies.grid.nearest(x, y, range, (e) => e.alive && !e.hidden && !e.air),
      damageEnemy: (e, m, dx, dy) => this.damageEnemy(e, m, dx, dy),
      runEffects: (list) => {
        for (const fx of list) runEffect(fx.effect, this.effects, fx.params as unknown as Params, 1);
      },
      fx: (name, x, y, scale) => this.fx.play(name, x, y, scale),
      audio: (cue, x, y) => this.audio.play(cue, x, y),
      toast: (msg, color) => this.toast(msg, color),
      feel: (preset, x, y) => this.feel.hit(preset, x, y),
    });
    this.mines = new MineSystem(this, combat.mineCap);
    this.hazards = new HazardSystem(this);
    // 장애물(서울 시가전 등 floor.json obstacles) + 적이 세우는 바리케이드
    this.obstacles = new ObstacleSystem(this, (floorData[this.stage.floor as keyof typeof floorData] as { obstacles?: ObstacleConfig }).obstacles ?? null, params.seed);
    this.enemies.blocker = this.obstacles;
    // 낮음 품질이면 배경 소품을 끈다
    this.props = new PropSystem(this, qualityPreset(this.pref.quality).props ? ((propsData.stages as Record<string, PropLayout>)[this.payload.stage] ?? null) : null, params.seed);
    // 상시 환경(혹한 등): 판 내내 걸린 수정자, 방해 수에 넣지 않음
    const envDef = this.stage.environment;
    if (envDef) this.player.addBuff(`env_${envDef.name}`, envDef.mods, 24 * 3600 * 1000, 0);
    this.flipOn = false;
    {
      const prof = loadProfile();
      this.ach = prof.achievements ?? emptyAchievements();
      this.codex = prof.codex ?? emptyCodex();
    }
    this.achMerit = 0;
    this.failRun = 0;
    this.lastHurtMs = 0;
    this.noHitFired = false;
    this.lowFpsMs = 0;
    this.autoLowered = false;
    this.safeZone = null;
    this.opsOpen = false;
    this.revealUntil = 0;
    this.dome = null;
    this.domeGfx = null;
    this.nextPeriodicMs = 0;
    this.shopOpen = false;
    this.shopState = null;
    this.supply = null;
    this.lastInterceptToastMs = -Infinity;
    this.enemyAttacks = new EnemyAttackSystem(this, {
      feel: this.feel,
      audio: this.audio,
      hitPlayer: (attack, x, y, cause) => this.hitPlayer(attack, x, y, cause),
      player: () => this.player,
      placeMine: (x, y, mine, attack) => this.mines.place(x, y, { faction: 'enemy', ...mine, damage: attack }, this.clock.timeMs),
      aliveCount: (id) => this.enemies.pool.active.reduce((n, e) => n + (e.alive && e.id === id ? 1 : 0), 0),
      blocks: (x0, y0, x1, y1) => this.obstacles.blocks(x0, y0, x1, y1),
      cue: (name, x, y) => this.timelines.cue(name, x, y),
      placeBarricade: (x, y, w, h, lifeMs, hp) => this.obstacles.addBarricade(x, y, w, h, this.clock.timeMs + lifeMs, hp * this.enemies.scaleHp()),
      summon: (id, x, y) => {
        if (!isEnemyId(id)) return;
        this.enemies.spawn(id, x, y, this.clock.timeMs, true);
        this.timelines.cue('summon_puff', x, y);
      },
      placeHazard: (x, y, spec, attack) => {
        const h = spec.hazard;
        if (h) this.hazards.place(x, y, { kind: h.kind, faction: 'enemy', radius: spec.radius ?? 40, lifeMs: h.lifeMs, tickMs: h.tickMs, damage: attack }, this.clock.timeMs);
      },
      onEvent: (e, ev) => {
        if (ev.type === 'judged' && e === this.boss) this.events.emit('boss:judged', ev.result);
      },
    });
    this.npcs = new NpcSystem(this, rng.fork('npcs'));
    this.setupGuide();
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
      damage: (x, y, r, m) => {
        // 스킬·조합 연출 피해는 공중 유닛에도(대공 판정)
        this.airStrike = true;
        this.explode(x, y, r, m, undefined, 1, undefined);
        this.airStrike = false;
      },
      damageEnemy: (e, m, dx, dy) => this.damageEnemy(e, m, dx, dy, true),
      cutCooldowns: (frac, from) => this.skills.cutCooldowns(frac, this.clock.timeMs, from),
      interceptActive: () => this.antiAirOnScreen(),
      dome: (d) => {
        this.dome = { untilMs: this.clock.timeMs + d.ms, reduce: d.reduce, reflect: d.reflect, radius: d.radius, color: parseColor(d.color) };
        this.toast(t('battle.dome', { sec: Math.round(d.ms / 1000), pct: Math.round(d.reduce * 100) }), '#7fd8ff');
      },
      onIntercept: () => {
        const now = this.clock.timeMs;
        if (now - this.lastInterceptToastMs < combat.intercept.toastGapMs) return;
        this.lastInterceptToastMs = now;
        this.toast(t('battle.antiAir'), '#ff8060');
      },
      enemiesOnScreen: () => {
        const v = this.cameras.main.worldView;
        return this.enemies.pool.active.filter((e) => e.alive && v.contains(e.x, e.y));
      },
    });
    const scene = this;
    this.upgradeTarget = {
      get rarePlus() {
        return scene.charDef.levelUpBonus?.rarePlusBonus ?? 0;
      },
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

    this.applyRunStart();
    if (params.auto) {
      // 자동 진행: 배율 시계, 단순 원운동(결정적: 전투 시계 기준)
      this.clock.debugSpeed = params.speed > 0 ? params.speed : 1;
      this.autoNextCardMs = 0;
      this.controls.autoMove = () => {
        const a = this.clock.timeMs / 1500;
        return { x: Math.cos(a), y: Math.sin(a) };
      };
    }
    this.debug = new DebugOverlay(this, this.clock, params.debug, () => {
      const p = this.player;
      return [
        `player ${p.id} ${p.action} hp ${p.hp}/${p.maxHp} (${Math.round(p.x)}, ${Math.round(p.y)})${this.invincible ? ' [GOD]' : ''}`,
        `enemies ${this.enemies.alive}${this.enemies.stress ? ' [STRESS]' : ''} pool ${this.enemies.pool.capacity} (created ${this.enemies.pool.created})`,
        `weapons ${this.weapons.equipped.map((w) => w.id).join(',')} shots ${this.projectiles.active} fx ${this.fx.active}`,
        `cards hand ${this.cards.state.hand.map((c) => c.id).join(',')} sel ${this.cards.selected.length} op ${this.cards.state.op} seals ${this.cards.state.seals} deck ${this.cards.state.drawPile.length}`,
        `lv ${this.progression.level} (${Math.round(this.progression.progress * 100)}%) pending ${this.progression.pending} rerolls ${this.progression.rerolls}`,
        `ms ${this.perf.summary()} · speed ×${this.clock.debugSpeed} · stop ${((this.clock.hitstopTotalMs / Math.max(1, this.clock.realTotalMs)) * 100).toFixed(1)}%`,
        `effects pending ${this.effects.pending} timelines ${this.timelines.active} buffs ${this.player.buffs.list.map((b) => b.id).join(',') || '-'} tp ${Math.round(this.skills.tp)} combos ${this.run.comboSuccesses} tactical ${this.progression.tacticalSlots}`,
        `xp ${this.run.xp} kills ${this.run.kills} gems ${this.pickups.active} taken ${this.run.damageTaken} blocks ${this.run.blocks}`,
        `feel particles ${this.feel.particles.active}/${this.feel.particles.cap} numbers ${this.feel.numbers.active} combo ${this.feel.combo.count}`,
        `audio ${this.audio.enabled ? `voices ${this.audio.activeVoices} played ${this.audio.played} dropped ${this.audio.dropped}` : 'off'}`,
        params.debug ? 'J atk K guard L skill U crit O slow F10 char V grenade I god B big-kill N lvl F2 300 foes F3 card F4 combo F5 elite F6 speed F7 slots F8 flip F9 NPC F11 support Esc pause' : '',
      ].filter(Boolean);
    });

    // 창·탭을 벗어나면 자동 일시정지(돌아왔을 때 이미 맞고 있지 않게)
    const autoPause = () => {
      if (!this.run.defeated && !this.result && !this.clock.hasScale('pause')) this.togglePause();
    };
    this.game.events.on(Phaser.Core.Events.BLUR, autoPause);
    // 렌더 시간(성능 측정, D40): 게임 전체 그리기 앞뒤
    this.perf.resetTotals();
    let renderStart = 0;
    const preRender = () => (renderStart = performance.now());
    const postRender = () => this.perf.record('render', performance.now() - renderStart);
    this.game.events.on(Phaser.Core.Events.PRE_RENDER, preRender);
    this.game.events.on(Phaser.Core.Events.POST_RENDER, postRender);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.PRE_RENDER, preRender);
      this.game.events.off(Phaser.Core.Events.POST_RENDER, postRender);
    });
    this.game.events.on(Phaser.Core.Events.HIDDEN, autoPause);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, autoPause);
      this.game.events.off(Phaser.Core.Events.HIDDEN, autoPause);
      this.controls.destroy();
      this.floor.destroy();
      this.audio.destroy();
      this.events.off('timeline:hook');
      this.scene.stop(SceneKey.Hud);
    });
    this.scene.launch(SceneKey.Hud);
  }

  /** 스타팅 포인트(§8.2): 세이브에서 계산한 런 시작 상태를 이번 판에 적용(레벨은 선택지 대기로) */
  private applyRunStart(): void {
    const rs = runInit(loadProfile(), metaData.startUpgrades as Record<string, StartUpgradeDef>);
    if (rs.handSizeBonus > 0) this.player.addMods([{ stat: 'handSize', op: 'add', value: rs.handSizeBonus }]);
    if (rs.sealOpReduction > 0) this.player.addMods([{ stat: 'sealOpReduction', op: 'add', value: rs.sealOpReduction }]);
    if (rs.weaponDamageMul > 0) for (const id of this.player.weapons) this.weapons.addMods(id, [{ stat: 'damageMult', op: 'mul', value: rs.weaponDamageMul }]);
    if (rs.seals > 0) this.cards.state = { ...this.cards.state, seals: Math.min(CARD_DATA.rules.maxSeals, this.cards.state.seals + rs.seals) };
    if (rs.tp > 0) this.skills.addTp(rs.tp);
    if (rs.level > 1) {
      let need = 0;
      for (let lv = 1; lv < rs.level; lv++) need += xpToNext(lv, levels.xp);
      this.progression.addXp(need);
    }
  }

  /** 캐릭터 시작 무기 + 패시브(무기 수정자·이벤트 트리거). 캐릭터를 바꾸면 다시 부른다 */
  private equipStartingWeapons(): void {
    this.weapons.clear();
    for (const id of this.player.weapons) if (isWeaponId(id)) this.weapons.add(id);
    const passive = passiveOf(this.player.id);
    const wm = passive.flatMap((p) => p.weaponMods ?? []);
    if (wm.length > 0) for (const id of this.player.weapons) this.weapons.addMods(id, wm);
    this.triggers = passive.filter((p) => p.trigger && p.effect).map((def) => ({ def, readyAt: 0 }));
  }

  /** 패시브 이벤트 트리거(hit·crit·kill): 확률·쿨다운 통과 시 효과를 그 자리 중심으로 실행(캐릭터별 분기 없음) */
  private triggers: { def: PassiveDef; readyAt: number }[] = [];

  private fireTriggers(on: 'hit' | 'crit' | 'kill', x: number, y: number): void {
    if (this.triggers.length === 0) return;
    const now = this.clock.timeMs;
    for (const t of this.triggers) {
      if (t.def.trigger !== on || now < t.readyAt || this.combatRng.next() >= (t.def.chance ?? 1)) continue;
      t.readyAt = now + (t.def.cooldownMs ?? 0);
      const at = Object.create(this.effects, { player: { value: { x, y, facing: this.player.facing } } }) as EffectRunner;
      runEffect(t.def.effect as string, at, (t.def.params ?? {}) as Params, 1);
    }
  }

  /** 근접 휘두르기: 부채꼴 안 적 전부 타격 + 밀어내기, 짧은 호 연출 */
  private melee(x: number, y: number, dx: number, dy: number, radius: number, arcDeg: number, mult: number, knockback: number): void {
    // 공중 유닛은 근접에 안 맞음
    const half = ((arcDeg / 2) * Math.PI) / 180;
    const hit: Enemy[] = [];
    this.enemies.grid.forEachNear(x, y, radius + MAX_ENEMY_RADIUS, (e, d2) => {
      const r = radius + e.radius;
      if (!e.alive || e.air || d2 > r * r) return;
      const ex = e.x - x;
      const ey = e.y - y;
      const off = Math.abs(Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey));
      if (off <= half || d2 < e.radius * e.radius) hit.push(e);
    });
    for (const e of hit) {
      this.damageEnemy(e, mult, e.x - x, e.y - y);
      if (e.alive && knockback > 0) {
        const l = Math.hypot(e.x - x, e.y - y) || 1;
        startKnockback(e.kb, (e.x - x) / l, (e.y - y) / l, knockback, 140);
      }
    }
    this.swings.push({ x, y: y - combat.bodyOffsetY * 0.5, a: Math.atan2(dy, dx), half, r: radius, until: this.clock.timeMs + 110, color: 0xfff0c0 });
    this.audio.play('hit', x, y);
  }

  private swings: { x: number; y: number; a: number; half: number; r: number; until: number; color: number }[] = [];

  override update(time: number, delta: number): void {
    // 같은 프레임에 Esc로 작전판·상점을 닫았으면 일시정지까지 가지 않게
    if (this.controls.justDown('pause') && !this.run.defeated && !this.result && !this.progression.isOpen && !this.modalOpen && this.game.loop.frame !== this.modalClosedFrame) this.togglePause();
    const dt = this.clock.tick(delta);
    this.feel.beginFrame(delta, this.clock.hardPaused);
    const now = this.clock.timeMs;
    const scale = this.clock.scale;
    const p = this.player;
    if (params.debug && !this.clock.hasScale('pause')) this.debugKeys(now);
    if (params.auto) this.autoTick(now);
    this.perf.start();
    this.autoQuality(delta);

    this.sprintTick(now);
    p.update(this.controls, dt, now, scale);
    const cam = this.cameras.main;
    // 장애물: 화면 주변 청크 준비 → 플레이어 밀어내기(벽 따라 미끄러짐은 이동 입력이 이어지며 자연히)
    this.obstacles.update(cam, now);
    this.props.update(cam, now, p);
    const pr = this.obstacles.resolve(p.x, p.y, combat.playerRadius);
    if (pr.x !== p.x || pr.y !== p.y) p.sprite.setPosition(pr.x, pr.y);
    this.perf.lap('world');
    // 플레이어는 늘 적보다 앞(포위돼도 위치가 보이게, PRD §6.4 가독성). 적끼리는 y 순서
    p.sprite.setDepth(Depth.Player);
    const target = { x: p.x, y: p.y, radius: combat.playerRadius };
    if (!this.run.defeated && !this.run.captured) this.stageTick(now);
    this.perf.lap('stage');
    this.enemies.update(dt, now, scale, target, cam, this.enemyAttacks, combat.minTelegraphMs);
    this.enemyAttacks.update(now, this.enemies.pool.active);
    this.perf.lap('enemies');
    if (!this.run.defeated && !this.run.captured) {
      const sight = this.obstacles.any ? (e: Enemy) => !this.obstacles.blocks(p.x, p.y, e.x, e.y) : undefined;
      this.weapons.update(dt, now, p, this.enemies.grid, this.projectiles, this.weaponHooks, this.threatFirst ? isPriorityTarget : undefined, sight);
      this.projectiles.update(dt, this.enemies.grid, this.hooks);
      this.contactDamage(now);
      this.support.update(now, dt);
      // 경험치 배율(전공 훈장 등)은 주울 때 곱한다
      const gained = this.pickups.update(dt, p.x, p.y, p.stats.magnet, now) * p.stats.xpMul;
      if (gained > 0) {
        this.audio.play('pickup');
        this.progression.addXp(gained);
      }
      this.run.xp += gained;
      this.perf.lap('combat');
      if (this.progression.pending > 0 && !this.progression.isOpen) this.openLevelUp();
      this.cards.update(dt, time);
      this.skillInput(now);
      this.perf.lap('cards');
      this.effects.update();
      this.timelines.update();
      this.perf.lap('skills');
      this.npcs.update(now, target, {
        onTalk: (id, text) => this.toast(`${npcData.npcs[id].name}: "${text}"`, '#e8dcc0'),
        onGive: (id) => {
          const def = npcData.npcs[id] as unknown as { effects: { effect: string; params: unknown }[]; action?: string };
          for (const fx of def.effects) runEffect(fx.effect, this.effects, fx.params as Params, 1);
          this.achEvent({ type: 'npc', id });
          if (def.action === 'shop') this.openShop();
          else if (def.action === 'safeZone') this.placeSafeZone();
          else if (def.action === 'hiddenSupply') {
            this.placeSupply();
            this.toast(t('battle.hiddenSupplyShown'), '#6fd06f');
          }
          this.audio.play('heal');
        },
      });
      this.guideTick(now);
      this.hazards.update(now, target, { hitPlayer: (x, y, spec) => this.hitPlayer(spec.damage, x, y, spec.kind) });
      this.syncFlip();
      // 포위망(D35): 스폰 밀도 + 사방 고르게, 플레이어 이동 배율
      this.enemies.encircle = Math.max(1, ...this.disruptions.active.map((a) => DTYPES[a.type]?.spawnMul ?? 1));
      p.envSpeedMul = Math.min(1, ...this.disruptions.active.map((a) => DTYPES[a.type]?.playerSpeedMul ?? 1));
      this.updateSupply();
      this.periodicSupport(now);
      this.drawDome(now);
      this.updateSafeZone(now);
      // 업적 '무사 귀환': 5분 동안 피해 없음(판당 한 번), 도감: 손에 들어온 카드
      if (!this.noHitFired && now - this.lastHurtMs >= 300_000) {
        this.noHitFired = true;
        this.achEvent({ type: 'noHit', sec: Math.floor((now - this.lastHurtMs) / 1000) });
      }
      for (const c of this.cards.state.hand) if (!c.disguised && !c.faceDown) this.codex = addSeen(this.codex, 'cards', c.id);
      this.mines.update(now, this.enemies.grid, target, {
        onExplode: (x, y, spec) => {
          this.timelines.cue('mine_blast', x, y);
          if (spec.faction === 'ally') this.explode(x, y, spec.radius, spec.damage, undefined, 1, undefined);
          else this.hitPlayer(spec.damage, x, y, 'mine');
        },
      });
      this.comboSupply(now);
      this.perf.lap('misc');
    }
    this.fx.update(this.clock.effectScale);
    this.feel.update(this.clock.effectDeltaMs);
    this.perf.lap('feel');
    this.audio.update({ paused: this.clock.hardPaused, slowmo: this.clock.hasScale('slowmo'), judge: this.clock.hasScale('judge') }, cam.midPoint.x, cam.midPoint.y);
    this.perf.lap('audio');
    // 피격 무적 중 깜빡임
    p.sprite.setAlpha(now < p.invulnUntilMs && Math.floor(now / combat.invulnBlinkMs) % 2 === 0 ? combat.invulnBlinkAlpha : 1);
    this.drawHpBar();
    this.drawSwings(now);
    this.floor.update(cam);
    this.perf.lap('floor');
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
      // 기습(A28): 체력이 가득한 적에게 치명 확률 +
      { attack: s.attack * damageMult * taken, critChance: s.critChance + (e.hp >= e.maxHp ? s.ambushCrit : 0), critMult: s.critMult, defense: e.def.defense, ...HIT },
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
    this.fireTriggers(res.crit ? 'crit' : 'hit', e.x, e.y);
    if (res.crit) this.fireTriggers('hit', e.x, e.y);
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
    this.fireTriggers('kill', e.x, e.y);
    // 업적·도감: 처치한 적
    this.achEvent({ type: 'kill', tier: e.def.tier, enemy: e.id });
    this.codex = addSeen(this.codex, 'enemies', e.id);
    if (e.def.tier === 'elite') this.run.eliteKills++;
    if (e === this.boss) this.capture(e.x, e.y);
    // 방해원 처치: 그 적이 건 방해에서 빠지고, 원인이 모두 죽으면 해제
    for (const d of this.disruptions.removeSource(e.uid)) this.toast(t('battle.disruptCleared', { name: DISRUPTION_NAMES[d.type] ?? d.type }), '#7fd8ff');
    this.skills.addTp(TP_BY_TIER[e.def.tier] ?? TP.perKill);
  }

  /** 판정이 끝난 카드 결과를 효과로(PRD §5.1·§5.3.1). 조합 스킬 전용 연출(D10~D11) 전에는 쓰인 카드 효과를 배수로 대신 낸다 */
  private onCardEvent(ev: CardEvent): void {
    if (ev.type === 'cardEffect' || ev.type === 'comboSkill') {
      const cards = ev.type === 'cardEffect' ? [ev.card] : ev.cards;
      this.disruptionInteractions(cards.map((c) => CARD_DATA.cards[c.id]?.tag ?? ''));
    }
    if (ev.type === 'cardEffect') this.runCard(ev.card.id, this.cardPower([ev.card]));
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
        // 위력: 조합 배율 × 아군 공격(A20) × 태그 강화(A23 해군)
        const pow = s.comboPower * s.allyPower * this.cardPower(ev.cards);
        if (this.timelines.play(ev.combo, pow)) return;
        const power = cardsData.comboFallbackPower * pow;
        for (const c of ev.cards) if (CARD_DATA.cards[c.id]?.tag !== 'minus') this.runCard(c.id, power);
      });
      this.run.comboSuccesses++;
      this.skills.addTp(TP.perComboSuccess);
      if (this.run.comboSuccesses % levels.tacticalEvery === 0) {
        this.progression.tacticalSlots++;
        this.toast(t('battle.tacticalSlot'), '#7fd8ff');
      }
    }
  }

  /** 캐릭터 정의(카드 보정·강화 등 능력치 밖 성질) */
  get charDef(): CharDef {
    return (characterData.characters as Record<string, CharDef>)[this.player.id] ?? {};
  }

  /** 주기 공중 지원(A29 헬기 조종사): everyMs마다 타임라인(아군 공격 배율 적용) */
  private periodicSupport(now: number): void {
    const per = this.charDef.periodic;
    if (!per) return;
    if (this.nextPeriodicMs === 0) this.nextPeriodicMs = now + per.everyMs;
    if (now < this.nextPeriodicMs || this.enemies.alive === 0) return;
    this.nextPeriodicMs = now + per.everyMs;
    this.timelines.play(per.timeline, this.player.stats.allyPower);
  }

  /** 태그 강화(A23 해군 카드 +50%): 쓰인 카드 태그 중 가장 큰 강화 */
  private cardPower(cards: readonly { id: string }[]): number {
    const cp = this.charDef.cardPower ?? {};
    return 1 + Math.max(0, ...cards.map((c) => cp[CARD_DATA.cards[c.id]?.tag ?? ''] ?? 0));
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
    this.toast(t(evs.some((e) => e.type === 'drawn') ? 'battle.comboDrawCard' : 'battle.comboDrawOp', { n: next }), '#ffe14d');
  }

  /** 곡사 착지·카드 포격: 범위 안 모든 적에게 피해 + 폭발 이펙트(mult 0이면 연출만) */
  private explode(x: number, y: number, radius: number, mult: number, fxName: string | undefined, fxScale: number, impact: string | undefined, tag?: string): void {
    const cy = y - combat.bodyOffsetY * 0.4;
    if (fxName) this.fx.play(fxName, x, cy, fxScale);
    if (impact) this.feel.hit(impact, x, cy, { groundY: y });
    if (mult <= 0 || radius <= 0) return;
    // 아군 폭발은 범위 안 적 지뢰를 걷어낸다(지뢰 지대 제거)
    for (const m of this.mines.clearInRadius(x, y, radius, 'enemy')) this.fx.play('explosion_s', m.x, m.y - 6, 0.4);
    const hit: Enemy[] = [];
    this.enemies.grid.forEachNear(x, y, radius + MAX_ENEMY_RADIUS, (e, d2) => {
      const r = radius + e.radius;
      // 공중 유닛은 지상 폭발에 안 맞음(스킬·조합 연출 피해는 맞음, D34)
      if (e.alive && (!e.air || this.airStrike) && d2 <= r * r) hit.push(e);
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
      if (e.alive && !e.air && d2 <= r * r) {
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
    // 장갑(전차병 등): 공격 종류별 피해 배율(대전차포는 antiTank, D23)
    const kind = cause.endsWith('antiTank') ? 'antiTank' : 'normal';
    // 신병 모드(편의 옵션): 받는 피해 −30%, 방어 돔(AS10) −reduce
    const dome = this.dome && now < this.dome.untilMs ? this.dome : null;
    const recruit = (this.pref.recruit ? settingsData.recruitDamageMul : 1) * (dome ? 1 - dome.reduce : 1);
    // 회피(A24) + 이동 중 회피(A27, 조건부)
    const dodgeChance = p.stats.dodge + (p.isMoving ? p.stats.dodgeMoving : 0);
    const res = computeHit({ attack: attack * armorMult(p.armorType, kind, combat.armor) * recruit, critChance: 0, critMult: 1, defense: p.stats.defense, ...HIT, dodgeChance }, this.combatRng);
    if (res.dodged) {
      this.feel.numbers.show('block', p.x, p.y - combat.bodyOffsetY - 10, 'MISS');
      this.feel.flash(p.sprite, 0xffffff, 60);
      return;
    }
    p.hp = Math.max(0, p.hp - res.damage);
    this.lastHurtMs = now;
    // 반사: 받은 피해의 일부를 쏜 자리 가까운 적에게
    if (dome && dome.reflect > 0) {
      const src = this.enemies.grid.nearest(fromX, fromY, 40, (e) => e.alive);
      if (src) this.damageEnemy(src, (res.damage * dome.reflect) / Math.max(1, p.stats.attack), src.x - p.x, src.y - p.y, true);
    }
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
    if (this.progression.isOpen || this.modalOpen || this.run.captured || this.clock.hasScale('pause')) return;
    SKILL_ACTIONS.forEach((a, i) => {
      if (this.controls.justDown(a)) this.castSkill(i, now);
    });
  }

  castSkill(i: number, now = this.clock.timeMs): boolean {
    const r = this.skills.cast(i, now, this.player.stats.skillCooldown);
    if (!r.ok) {
      this.audio.play('skill_denied');
      this.toast(`${this.skills.slots[i]?.key ?? ''}: ${t(`battle.cast.${r.reason satisfies CastReject}`)}`, '#b0a890');
      return false;
    }
    if (r.def.cutIn) {
      // 컷인(PRD §6.4): 전투 시계를 cutInMs 멈추고 HUD가 실시간으로 띠를 그린다. 연출은 시계가 풀린 뒤 시작
      this.clock.pause('cutin');
      this.events.emit('cutin', r.def.name);
      this.time.delayedCall(skillsData.cutInMs, () => this.clock.resume('cutin'));
    }
    this.timelines.play(r.def.timeline as string, this.player.stats.allyPower);
    this.player.trigger('skill', now);
    this.achEvent({ type: 'skill', id: this.skills.slots[i]?.skillId ?? '' });
    this.run.skillsUsed++;
    this.toast(`${r.def.name}!`, '#7fd8ff');
    return true;
  }

  /** 전사: 전투 정지 → 잠시 후 재시작(결과 화면은 D13) */
  private defeat(): void {
    this.run.defeated = true;
    this.clock.pause('defeat');
    this.bannerMessage = t('hud.result.defeat');
    this.time.delayedCall(combat.defeatResultMs, () => this.showResult(false));
  }

  /** 스테이지 진행: 스폰 표·밀도, 엘리트·방해·보스 예고와 등장 */
  private stageTick(now: number): void {
    const sec = now / 1000;
    const view = this.cameras.main.worldView;
    let onScreen = 0;
    for (const e of this.enemies.pool.active) if (e.alive && view.contains(e.x, e.y)) onScreen++;
    for (const ev of this.director.update(sec, this.progression.level, { enemiesOnScreen: onScreen })) this.onStageEvent(ev, now);
    const sp = this.director.spawnsAt(sec);
    this.enemies.setSpawns(sp.spawns, sp.mult);
    this.disruptorTick();
    for (const d of this.disruptions.update(sec)) this.toast(t('battle.disruptEnded', { name: DISRUPTION_NAMES[d.type] ?? d.type }), '#b0a890');
  }

  /** 걸린 방해가 막는 카드 태그(악천후 → 공군) */
  blockedTags(): string[] {
    return [...new Set(this.disruptions.active.flatMap((a) => DTYPES[a.type]?.blockTags ?? []))];
  }

  /** 드로우 속도 배율: 걸린 방해 중 가장 낮은 값(보급선 차단 0.5) */
  drawMul(): number {
    return Math.min(1, ...this.disruptions.active.map((a) => DTYPES[a.type]?.drawMul ?? 1));
  }

  /** 방어 돔 그리기(청록 반투명 원, 끝 2초는 깜빡임) */
  private drawDome(now: number): void {
    const d = this.dome;
    this.domeGfx ??= this.add.graphics().setDepth(Depth.Player + 2);
    const g = this.domeGfx.clear();
    if (!d) return;
    if (now >= d.untilMs) {
      this.dome = null;
      return;
    }
    const left = d.untilMs - now;
    if (left < 2000 && Math.floor(now / 120) % 2 === 0) return;
    const p = this.player;
    g.fillStyle(d.color, 0.12).fillEllipse(p.x, p.y - 10, d.radius * 2, d.radius * 1.6);
    g.lineStyle(2, d.color, 0.7).strokeEllipse(p.x, p.y - 10, d.radius * 2, d.radius * 1.6);
  }

  /** 환경 보정: 걸린 방해의 태그 감점(같은 태그는 가장 큰 값 하나, 중첩 없음) */
  tagPenalty(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.disruptions.active) {
      for (const [tag, v] of Object.entries(DTYPES[a.type]?.tagPenalty ?? {})) out[tag] = Math.max(out[tag] ?? 0, v);
    }
    return out;
  }

  /** 방공 적(antiAir)이 화면에 있는지(항공 스킬 요격) */
  private antiAirOnScreen(): boolean {
    const v = this.cameras.main.worldView;
    return this.enemies.pool.active.some((e) => e.alive && (e.def as { antiAir?: boolean }).antiAir === true && v.contains(e.x, e.y));
  }

  /** 뒤집힌 카드 방해가 걸리면 손패 2~3장을 뒷면으로, 풀리면 모두 앞면으로 */
  private syncFlip(): void {
    const on = this.disruptions.has('flip');
    if (on === this.flipOn) return;
    this.flipOn = on;
    const [lo = 2, hi = lo] = (DTYPES.flip as { flipCount?: number[] } | undefined)?.flipCount ?? [];
    if (on) this.cards.act({ type: 'flipHand', count: lo + Math.floor(this.combatRng.next() * (hi - lo + 1)) });
    else this.cards.act({ type: 'unflip' });
  }

  /** 자동 조준 위협 우선(설정, 기본 켬) */
  private get threatFirst(): boolean {
    return this.pref.threatFirst;
  }

  /** 방해원(G6): 플레이어가 반경 안이면 그 방해를 건다(같은 방해는 원인만 더함) */
  private disruptorTick(): void {
    const p = this.player;
    for (const e of this.enemies.pool.active) {
      const d = (e.def as { disrupt?: { type: string; radius: number } }).disrupt;
      if (!d || !e.alive || this.disruptions.sourcesOf(d.type).includes(e.uid)) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > d.radius * d.radius) continue;
      const def = DTYPES[d.type];
      if (!def) continue;
      const had = this.disruptions.has(d.type);
      if (this.disruptions.addSource({ type: d.type, category: def.category, priority: def.priority }, e.uid) && !had) {
        this.toast(`${def.name}! ${def.hint}`, '#ff8060');
        this.audio.play('debuff');
      }
    }
  }

  /** 지금 걸린 방해의 카드 선택 지연(ms, 통신 노이즈 0.5초) */
  get selectDelayMs(): number {
    return Math.max(0, ...this.disruptions.active.map((a) => DTYPES[a.type]?.selectDelayMs ?? 0));
  }

  /** 방해 × 카드 상호작용(G9): 걸린 방해마다 정의된 조건이 맞으면 실행 */
  private disruptionInteractions(tags: readonly string[]): void {
    for (const a of this.disruptions.active) {
      for (const it of DTYPES[a.type]?.interactions ?? []) {
        if (it.on !== 'cardSuccess' || !tags.includes(it.tag)) continue;
        if (it.do === 'revealSources') {
          const ids = new Set(a.sources ?? []);
          for (const e of this.enemies.pool.active) if (ids.has(e.uid)) this.feel.flash(e.sprite, 0xff5040, it.ms);
          this.revealUntil = this.clock.timeMs + it.ms;
          this.toast(t('battle.disruptSource', { name: DISRUPTION_NAMES[a.type] ?? a.type }), '#7fd8ff');
        }
      }
    }
  }

  /** 이 시각까지 방해원 화살표 강조(HUD) */
  revealUntil = 0;

  /** 화면 밖 방해원(HUD 가장자리 화살표) */
  disruptorsOffscreen(): { x: number; y: number }[] {
    const v = this.cameras.main.worldView;
    const out: { x: number; y: number }[] = [];
    for (const e of this.enemies.pool.active) {
      if (!e.alive || !(e.def as { disrupt?: unknown }).disrupt || v.contains(e.x, e.y)) continue;
      out.push({ x: e.x - v.x, y: e.y - v.y });
    }
    return out;
  }

  private onStageEvent(ev: StageEvent, now: number): void {
    const p = this.player;
    const name = (id: string) => (enemyData.enemies as Record<string, { name: string }>)[id]?.name ?? id;
    switch (ev.type) {
      case 'eliteWarn':
        this.events.emit('warn', t('battle.warn.elite', { name: name(ev.enemy) }), ev.inSec);
        this.audio.play('debuff');
        break;
      case 'elite':
        this.enemies.spawnAround(ev.enemy as EnemyId, { x: p.x, y: p.y, radius: combat.playerRadius }, now, true);
        break;
      case 'disruptionWarn':
        this.events.emit('warn', t('battle.warn.disrupt', { name: DISRUPTION_NAMES[ev.def.type] ?? ev.def.type }), ev.inSec);
        break;
      case 'disruption':
        if (this.disruptions.add(ev.def, now / 1000)) this.toast(`${DISRUPTION_NAMES[ev.def.type] ?? ev.def.type}! ${DTYPES[ev.def.type]?.hint ?? ''}`, '#ff8060');
        break;
      case 'bossWarn':
        this.events.emit('warn', t('battle.warn.boss', { name: name(ev.enemy) }), ev.inSec, 'boss');
        this.audio.play('debuff');
        this.saveCheckpoint();
        break;
      case 'boss': {
        const b = this.enemies.spawnAround(ev.enemy as EnemyId, { x: p.x, y: p.y, radius: combat.playerRadius }, now, true);
        if (b) {
          this.boss = b;
          this.timelines.cue('boss_intro', b.x, b.y);
          this.events.emit('boss:spawn', b);
          this.audio.playBgm(this.stage.bossBgm ?? null);
        }
        break;
      }
      case 'npc':
        this.npcs.spawn(ev.npc as NpcId, p, now, (x, y) => this.obstacles.resolve(x, y, 24));
        this.toast(t('battle.npcArrive', { name: npcData.npcs[ev.npc as NpcId]?.name ?? ev.npc }), '#6fd06f');
        break;
      case 'burstWarn':
        this.events.emit('warn', ev.burst.label ?? t('battle.warn.burst', { name: name(ev.burst.enemy) }), ev.inSec);
        this.audio.play('debuff');
        break;
      case 'burst':
        this.enemies.burst(ev.burst.enemy, ev.burst.count, ev.burst.arcDeg);
        break;
      case 'pacing':
        this.toast(ev.label, ev.mult > 1 ? '#ff8060' : '#7fd8ff');
        break;
    }
  }

  /** 가이드 준비: 저장에서 본 팁·켜짐을 읽고, 첫 판이면 첫 손패에 연습 짝(공군+정보) */
  private setupGuide(): void {
    const prof = loadProfile();
    this.guide = new Guide(guideData.tips, { enabled: prof.settings.guide, seen: prof.flags.guideSeen }, (s) =>
      updateProfile((d) => {
        d.flags.guideSeen = s.seen;
      }),
    );
    if (this.guide.enabled && !prof.flags.firstRunDone) {
      this.cards.seedPractice(guideData.practicePair);
      updateProfile((d) => {
        d.flags.firstRunDone = true;
      });
    }
  }

  /** 상황이 처음 생기면 한 줄 팁(HUD) */
  tip(id: string): void {
    const text = this.guide?.trigger(id);
    if (text) this.events.emit('guide', text);
  }

  private guideTick(now: number): void {
    if (!this.guide.enabled) return;
    const t = now / 1000;
    const hand = this.cards.state.hand;
    if (t >= guideData.moveAtSec) this.tip('move');
    if (t >= guideData.sprintAtSec) this.tip('sprint');
    if (t >= guideData.firstCardAtSec && hand.length > 0) {
      if (this.cards.state.stats.submits > 0) this.guide.skip('firstCard');
      else this.tip('firstCard');
    }
    if (this.guide.has('firstCard') && t >= guideData.firstCardAtSec + 15 && this.cards.advice()?.combo) this.tip('firstPair');
    if (this.run.skillsUsed > 0) this.guide.skip('skillReady');
    else if (this.skills.check(0, now) === null) this.tip('skillReady');
    if (this.cards.state.seals > 0) this.tip('firstSeal');
    if (hand.some((c) => CARD_DATA.cards[c.id]?.tag === 'minus')) this.tip('firstMinus');
    if (this.disruptions.active.length > 0) this.tip('firstDisruption');
  }

  /** 보스 진입 순간 런 상태 저장(보스 재도전 1회 기반, 재도전 UI는 D19) */
  private saveCheckpoint(): void {
    const data = {
      stage: this.payload.stage,
      char: this.player.id,
      level: this.progression.level,
      timeSec: Math.round(this.clock.timeMs / 1000),
      upgrades: this.progression.history.map((h) => h.id),
      savedAt: Date.now(),
    };
    updateProfile((d) => {
      d.flags.bossCheckpoint = data;
    });
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
    this.bannerMessage = t('battle.captured', { name: this.stage.name });
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
      ...(this.pref.recruit ? { recruit: true } : {}),
      unspentMerit: loadProfile().merit,
      sealsHeld: cs.seals,
      residueDamage: Math.round(this.run.residueDamage),
      comboSuccesses: this.run.comboSuccesses,
      lastHitBy: this.run.lastHitBy,
    };
    // 위협 등급(뉴게임+)은 전공 보상도 올림
    const threat = this.enemies.threat;
    const merit = Math.round(meritPoints(record, metaData.merit) * threatReward(threat));
    const step = globalStep(stageNumber(this.payload.stage), record.level);
    if (victory) this.achEvent({ type: 'capture', stage: this.payload.stage, timeSec: record.timeSec, threat });
    // 마지막 지역 점령 = 엔딩(뉴게임+ 열림)
    const ending = victory && this.payload.stage === FINAL_STAGE;
    // 정산: 점령 기록·전공·첫 점령 해금(core/meta), 최고 전역 단계
    let unlocked: Unlock[] = [];
    updateProfile((d) => {
      const r = applyCapture(d, this.payload.stage, { victory, timeSec: record.timeSec, merit }, unlocksData.stages as Record<string, UnlockEntry>);
      unlocked = r.unlocked;
      const next = { ...r.save, bestStep: Math.max(r.save.bestStep ?? 0, step), achievements: this.ach, codex: this.codex, merit: r.save.merit + this.achMerit };
      if (ending) next.flags = { ...next.flags, endingSeen: true };
      return next;
    });
    this.result = { record, merit, tip: victory ? '' : defeatTip(record, metaData.tips), rate: actualRate(record), unlocked, step, threat, ending };
    this.clock.pause('result');
    this.bannerMessage = null;
    this.events.emit('result', this.result);
    this.audio.playBgm(null);
  }

  /** 다시 출정(같은 구성) */
  redeploy(): void {
    this.scene.restart(this.payload);
  }

  /** 마지막 지역 점령 뒤 엔딩 화면 */
  toEnding(): void {
    this.scene.stop(SceneKey.Hud);
    this.scene.start(SceneKey.Ending, { threat: this.enemies.threat });
  }

  /** 결과 뒤 작전지도로 */
  toMap(): void {
    const r = this.result;
    const payload: MapPayload = r ? { lastResult: { stage: this.payload.stage, victory: r.record.victory, merit: r.merit }, focus: this.payload.stage } : { focus: this.payload.stage };
    this.scene.stop(SceneKey.Hud);
    this.scene.start(SceneKey.Map, payload);
  }

  private swingGfx: Phaser.GameObjects.Graphics | null = null;

  /** 근접 휘두르기 호(0.11초) */
  private drawSwings(now: number): void {
    if (this.swings.length === 0 && !this.swingGfx) return;
    this.swingGfx ??= this.add.graphics().setDepth(Depth.Spark);
    const g = this.swingGfx.clear();
    this.swings = this.swings.filter((s) => s.until > now);
    for (const s of this.swings) {
      g.lineStyle(3, s.color, 0.8).beginPath().arc(s.x, s.y, s.r * 0.8, s.a - s.half, s.a + s.half).strokePath();
    }
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

  /** 작전판·상점 창이 열려 있음(전투 정지, 카드·스킬 입력 막음) */
  get modalOpen(): boolean {
    return this.opsOpen || this.shopOpen;
  }

  /** 전공 상점(N03): 전투를 멈추고 HUD가 창을 그린다 */
  openShop(): void {
    if (this.shopOpen || this.run.defeated) return;
    this.shopState = { merit: loadProfile().merit, bought: {} };
    this.shopOpen = true;
    this.clock.pause('shop');
    this.events.emit('shop:open');
  }

  buyShop(id: string): BuyResult {
    const r = buy(this.shopState ?? { merit: 0, bought: {} }, SHOP_ITEMS, id);
    if (!r.ok) {
      this.audio.play('card_reject');
      return r;
    }
    this.shopState = r.state;
    updateProfile((d) => {
      d.merit = r.state.merit;
    });
    runEffect(r.item.effect, this.effects, r.item.params as Params, 1);
    this.audio.play('pickup');
    return r;
  }

  closeShop(): void {
    if (!this.shopOpen) return;
    this.shopOpen = false;
    this.modalClosedFrame = this.game.loop.frame;
    this.clock.resume('shop');
  }

  /** 업적 이벤트: 메모리에서 판정, 달성하면 알림 + 보상 전공(정산 때 저장) */
  achEvent(ev: GameEvent): void {
    const r = applyEvent(this.ach, ev, ACH);
    this.ach = r.state;
    for (const d of r.unlocked) {
      this.achMerit += d.reward ?? 0;
      this.events.emit('achievement', d.name, d.reward ?? 0);
      this.audio.play('levelup');
    }
  }

  /** 카드 판정 → 업적(조합·인장·무리수·연속 실패 뒤 성공)·도감 */
  onJudged(success: boolean, j?: Extract<CardEvent, { type: 'judged' }>): void {
    const gamble = (j?.cards ?? []).some((c) => CARD_DATA.cards[c.id]?.tag === 'minus');
    this.achEvent({ type: 'cardJudged', success, combo: Boolean(j?.combo), seal: Boolean(j?.seal), gamble, failStreak: this.failRun });
    this.failRun = success ? 0 : this.failRun + 1;
  }

  /** 저사양 자동 하향: 전투 중 FPS가 autoLow.sec초 넘게 autoLow.fps 미만이면 한 단계 낮추고 저장(한 판에 한 번) */
  private autoQuality(deltaMs: number): void {
    const cfg = settingsData.quality.autoLow;
    if (this.autoLowered || this.clock.hardPaused || this.result) return;
    this.lowFpsMs = this.game.loop.actualFps < cfg.fps ? this.lowFpsMs + deltaMs : 0;
    if (this.lowFpsMs < cfg.sec * 1000) return;
    const order = settingsData.quality.order;
    const next = order[order.indexOf(this.pref.quality) + 1];
    this.autoLowered = true;
    if (!next) return;
    const qp = qualityPreset(next);
    this.feel.particles.setCap(qp.particles);
    this.feel.numbers.setCap(qp.numbers);
    this.feel.intensity.shake = feelData.intensity.shake * this.pref.feel * qp.shake;
    this.pref = { ...this.pref, quality: next };
    updateProfile((d) => {
      d.settings.quality = next;
    });
    this.toast(t('battle.autoQuality', { name: (settingsData.quality.names as Record<string, string>)[next] ?? next }), '#b0a890');
  }

  /** 임시 안전지대(N09): 플레이어 자리에 반경 r, ms 동안 */
  private placeSafeZone(): void {
    const cfg = npcData.safeZone;
    this.safeZone?.gfx.destroy();
    this.safeZone = { x: this.player.x, y: this.player.y, r: cfg.radius, untilMs: this.clock.timeMs + cfg.ms, gfx: this.add.graphics().setDepth(Depth.Decal + 3) };
    this.toast(t('battle.safeZone', { sec: Math.round(cfg.ms / 1000) }), '#ffe14d');
  }

  /** 안전지대: 안의 적(보스·공중 제외)을 가장자리 밖으로, 노란 점선 원 */
  private updateSafeZone(now: number): void {
    const z = this.safeZone;
    if (!z) return;
    if (now >= z.untilMs) {
      z.gfx.destroy();
      this.safeZone = null;
      return;
    }
    this.enemies.grid.forEachNear(z.x, z.y, z.r + 30, (e) => {
      if (!e.alive || e.air || e.tier === 'boss') return;
      const dx = e.x - z.x;
      const dy = e.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      const r = z.r + e.radius;
      if (d < r) e.setPosition(z.x + (dx / d) * r, z.y + (dy / d) * r);
    });
    const left = z.untilMs - now;
    const g = z.gfx.clear();
    if (left < 2000 && Math.floor(now / 150) % 2 === 0) return;
    g.fillStyle(0xffe14d, 0.06).fillEllipse(z.x, z.y, z.r * 2, z.r * 1.5);
    for (let i = 0; i < 24; i += 2) g.lineStyle(2, 0xffe14d, 0.7).beginPath().arc(z.x, z.y, z.r, (i / 24) * Math.PI * 2, ((i + 1) / 24) * Math.PI * 2).strokePath();
  }

  /** 숨은 보급품(N04): 화면 밖에 두고 HUD가 초록 화살표로 안내 */
  private placeSupply(): void {
    const cfg = npcData.hiddenSupply;
    const [lo = 500, hi = lo] = cfg.distance;
    const a = this.combatRng.next() * Math.PI * 2;
    const r = lo + this.combatRng.next() * (hi - lo);
    // 장애물(건물) 안에 떨어지면 닿을 수 없으므로 밖으로
    const at = this.obstacles.resolve(this.player.x + Math.cos(a) * r, this.player.y + Math.sin(a) * r, npcData.hiddenSupply.radius + 8);
    const { x, y } = at;
    this.supply?.sprite.destroy();
    const sprite = this.add.image(x, y, manifest.image('ui', 'supply_crate', 32, 32).key).setOrigin(0.5, 0.8).setDepth(Depth.Decal + 3);
    this.supply = { x, y, sprite };
  }

  private updateSupply(): void {
    const s = this.supply;
    if (!s) return;
    const r = npcData.hiddenSupply.radius + combat.playerRadius;
    if ((this.player.x - s.x) ** 2 + (this.player.y - s.y) ** 2 > r * r) return;
    for (const fx of npcData.hiddenSupply.effects) runEffect(fx.effect, this.effects, fx.params as unknown as Params, 1);
    this.feel.hit('card_success', s.x, s.y);
    this.audio.play('heal');
    this.toast(t('battle.hiddenSupplyGot'), '#6fd06f');
    s.sprite.destroy();
    this.supply = null;
  }

  /** 화면 밖 숨은 보급품 위치(화면 좌표, HUD 화살표). 화면 안이면 null */
  supplyOffscreen(): { x: number; y: number } | null {
    const s = this.supply;
    if (!s) return null;
    const v = this.cameras.main.worldView;
    if (v.contains(s.x, s.y)) return null;
    return { x: s.x - v.x, y: s.y - v.y };
  }

  /** 작전판(Tab): 전투를 완전히 멈추고 조합표·확률 내역을 본다 */
  setOpsBoard(on: boolean): void {
    this.opsOpen = on;
    if (on) this.clock.pause('ops');
    else {
      this.clock.resume('ops');
      this.modalClosedFrame = this.game.loop.frame;
    }
  }

  canOpenBoard(): boolean {
    return !this.run.defeated && !this.progression.isOpen && !this.clock.hasScale('pause') && !this.shopOpen;
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
  /** 자동 진행(D44 자동 QA): 레벨업 첫 칸, 상점 닫기, 카드 1장씩 제출, autoSec초가 지나면 결과 화면 */
  private autoNextCardMs = 0;
  private autoTick(now: number): void {
    if (this.result || this.run.defeated) return;
    if (this.progression.isOpen) this.pickUpgrade(0);
    if (this.shopOpen) this.closeShop();
    const c = this.cards;
    if (now >= this.autoNextCardMs && c.state.hand.length > 0 && c.selected.length === 0 && !c.judging) {
      this.autoNextCardMs = now + 3000;
      c.toggle(0);
      c.submit(false, this.time.now);
    }
    if (now >= params.autoSec * 1000) this.defeat();
  }

  /** 질주: 1초 빨리 달리기(처음 잠깐 무적), 먼지·잔상, 재사용 대기(combat.json sprint) */
  private sprintTick(now: number): void {
    const cfg = combat.sprint as SprintConfig;
    const p = this.player;
    const free = !this.run.defeated && !this.run.captured && !this.clock.hasScale('pause') && !this.progression.isOpen && !this.modalOpen;
    if (this.controls.justDown('sprint') && free) {
      const r = trySprint(this.sprint, now, cfg);
      if (r.ok) {
        this.sprint = r.state;
        p.invulnUntilMs = Math.max(p.invulnUntilMs, now + cfg.invulnMs);
        this.audio.play('dash');
        this.guide.skip('sprint');
        this.sprintFxAt = now;
        this.sprintGhostAt = now;
      } else this.audio.play('skill_denied');
    }
    p.sprintMul = sprintMul(this.sprint, now, cfg);
    if (!sprinting(this.sprint, now, cfg) || !p.isMoving) return;
    if (now >= this.sprintFxAt) {
      this.sprintFxAt = now + combat.sprint.dustEveryMs;
      this.fx.play('dust', p.x - p.facing * 10, p.y - 4, 0.45);
    }
    if (now >= this.sprintGhostAt) {
      // 잔상: 지금 프레임을 반투명 파랑으로 남겨 사라지게
      this.sprintGhostAt = now + combat.sprint.ghostEveryMs;
      const s = p.sprite;
      const ghost = this.add.image(s.x, s.y, s.texture.key, s.frame.name).setOrigin(s.originX, s.originY).setFlipX(s.flipX).setTint(0x7fd8ff).setAlpha(0.45).setDepth(Depth.Player - 1);
      this.tweens.add({ targets: ghost, alpha: 0, duration: combat.sprint.ghostMs, onComplete: () => ghost.destroy() });
    }
  }

  /** HUD 질주 게이지(0~1, 1 = 준비됨) */
  get sprintGauge(): number {
    return sprintReady(this.sprint, this.clock.timeMs, combat.sprint as SprintConfig);
  }

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
    if (this.controls.justDown('debugSlotE')) {
      // 슬롯 강제 개방: Q는 AS03 ↔ AS01, E는 AS05 → AS06 → AS04 차례, R은 AS08, TP 가득
      const [q, e, r, f] = this.skills.slots;
      if (f) {
        f.locked = false;
        f.skillId = 'AS10';
        f.readyAtMs = 0;
      }
      if (q && e && r) {
        const cycleE = ['AS05', 'AS06', 'AS04'];
        q.skillId = q.skillId === 'AS03' ? 'AS01' : 'AS03';
        q.readyAtMs = 0;
        e.locked = false;
        e.skillId = cycleE[(cycleE.indexOf(e.skillId ?? '') + 1) % cycleE.length] ?? 'AS05';
        e.readyAtMs = 0;
        r.locked = false;
        r.skillId = 'AS08';
        r.readyAtMs = 0;
        this.skills.addTp(100);
        this.toast(`[debug] Q = ${q.skillId}, E = ${e.skillId}, R = AS08, F = AS10`, '#b0a890');
      }
    }
    if (this.controls.justDown('debugSupport')) {
      this.support.drop(now);
      this.support.callSquad(now);
    }
    if (this.controls.justDown('debugNpc')) {
      // NPC 차례로(N01 → … → N05) 플레이어 곁에
      const ids = Object.keys(npcData.npcs) as NpcId[];
      const id = ids[this.debugNpcIndex++ % ids.length] as NpcId;
      this.npcs.spawn(id, p, now, (x, y) => this.obstacles.resolve(x, y, 24));
      this.toast(`[debug] ${id} ${npcData.npcs[id].name}`, '#b0a890');
    }
    if (this.controls.justDown('debugFlip')) {
      // 뒤집힌 카드 방해 15초
      const d = DTYPES.flip;
      if (d && this.disruptions.add({ type: 'flip', category: d.category, source: 'debug', priority: d.priority, durationSec: 15 }, now / 1000)) this.toast(`${d.name}! ${d.hint}`, '#ff8060');
    }
    if (this.controls.justDown('debugSpeed')) {
      this.clock.debugSpeed = this.clock.debugSpeed > 1 ? 1 : 8;
      this.toast(`[debug] speed ×${this.clock.debugSpeed}`, '#b0a890');
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
      this.toast(`[debug] ${id} ${CARD_DATA.cards[id]?.name ?? ''} given`, '#b0a890');
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
      // 스테이지별 적 확인용 묶음을 차례로(S1: 박격포병 3 + T-34, S2: 포위 4·저격 2·기관총 2·SU-76)
      const sets = DEBUG_SETS[this.debugSetIndex++ % DEBUG_SETS.length] ?? [];
      sets.forEach(([id, n]) => {
        for (let i = 0; i < n; i++) {
          const a = this.combatRng.next() * Math.PI * 2;
          this.enemies.spawn(id as EnemyId, p.x + Math.cos(a) * 320, p.y + Math.sin(a) * 220, now, true);
        }
      });
      this.toast(`[debug] ${sets.map(([id, n]) => `${id}×${n}`).join(' ')}`, '#b0a890');
    }
    if (this.controls.justDown('debugStress')) {
      this.enemies.setStress(!this.enemies.stress, { x: p.x, y: p.y, radius: combat.playerRadius }, now);
    }
    if (this.controls.justDown('debugCharacter')) {
      const next = CHARACTERS[(CHARACTERS.indexOf(p.id) + 1) % CHARACTERS.length] as CharacterId;
      p.setCharacter(next, now);
      this.equipStartingWeapons();
      this.toast(`[debug] ${characterData.characters[next].name}`, '#b0a890');
    }
  }
}
