import type * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import {
  Combo,
  FRAME_MS,
  Shaker,
  StopBudget,
  framesToMs,
  hitstopAllowed,
  lodAllows,
  parseColor,
  punchCurve,
  punchRestartElapsed,
  startKnockback,
  type Knockback,
} from '../core/feel';
import type { Rng } from '../core/rng';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Depth } from '../config/depth';
import { NO_AUDIO, type AudioSink } from './audio';
import { MAX_REAL_DELTA_MS, type GameClock } from './clock';
import { DamageNumbers, type NumbersData } from './damageNumbers';
import type { FxSystem } from './fx';
import { ParticleSystem, ensureParticleTextures, type ParticleKindData } from './particles';
import { PIXEL_FONT } from '../ui/pixelFont';

/** feel.json 프리셋. 없는 항목은 연출하지 않는다 */
export interface FeelPreset {
  /** 전역 히트스톱(화면 전체 정지). 치명 이상만 */
  hitstopFrames?: number;
  hitstopMinGapMs?: number;
  /** 정지 예산(초당 20%)과 상관없이 정지(대형 처치) */
  hitstopForce?: boolean;
  /** 국소 정지: 맞은 개체만 n프레임 멈춤(일반 타격) */
  localStopFrames?: number;
  /** 흔들림 누적(연속 착탄): true면 겹칠수록 커짐 */
  shakeStack?: boolean;
  /** 방향 킥: 타격 방향으로 화면을 순간 밈 */
  kickPx?: number;
  kickMs?: number;
  /** 입자 종류별 개수(feel.json particles.kinds 이름) */
  emit?: Record<string, number>;
  /** 효과음 이름(sfx.json cues) */
  sfx?: string;
  /** 연출 우선순위: lod.alwaysFrom 이상은 프레임 예산과 상관없이 전체 연출 */
  lod?: number;
  slowmoScale?: number;
  slowmoMs?: number;
  shakePx?: number;
  shakeMs?: number;
  flashColor?: string;
  flashFrames?: number;
  screenFlashFrames?: number;
  knockbackPx?: number;
  knockbackMs?: number;
  number?: string;
  sparks?: number;
  smoke?: number;
  debris?: number;
  crater?: number;
  fx?: string;
  fxScale?: number;
  zoomPunch?: number;
  squash?: boolean;
  vignette?: boolean;
  combo?: boolean;
}

/** 맞은 개체(적). 넉백·국소 정지는 개체 쪽 update가 전투 시계로 처리한다 */
export interface FeelTarget {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly kb: Knockback;
  /** 이 시각(전투 시계)까지 국소 정지 */
  freezeUntilMs: number;
  /** 등급(넉백 배율) */
  readonly tier: string;
}

export interface HitOptions {
  /** 맞은 적 */
  target?: FeelTarget;
  /** 점멸만 할 스프라이트(플레이어 등) */
  sprite?: Phaser.GameObjects.Sprite;
  /** 타격 방향(넉백·스파크 방향) */
  dirX?: number;
  dirY?: number;
  /** 데미지 숫자 */
  amount?: number;
  /** 연출 기준점의 지면 좌표 y(입자·데칼용). 없으면 y */
  groundY?: number;
}

const PRESETS = feelData.presets as Record<string, FeelPreset>;
const KILL_BY_TIER = feelData.killPresetByTier as Record<string, string>;
const KB_BY_TIER = feelData.knockbackMulByTier as Record<string, number>;
const LOD = feelData.lod;

export function feelPreset(name: string): FeelPreset | undefined {
  return PRESETS[name];
}

/**
 * 타격감 연출의 단일 진입점(PRD §4.4). 호출부는 feel.hit('crit', x, y, {...})처럼 프리셋 이름만 쓴다.
 * 시간 규칙: 히트스톱·슬로모는 전투 시계(clock)에 요청하고, 흔들림·점멸·줌 등 화면 연출은 실시간으로 흐른다
 * (히트스톱 중에도 흔들림이 보여야 손맛이 난다). 숫자·입자는 이펙트 delta(히트스톱 무시, 일시정지·슬로모 따름),
 * 넉백은 전투 시계 delta로 움직인다(맞은 적은 히트스톱 동안 멈춰 있다가 밀려난다).
 */
export class Feel {
  /** 접근성 강도 배율 0~1(PRD §11). 설정 화면(D29)이 바꾼다 */
  readonly intensity = { ...feelData.intensity };
  readonly numbers: DamageNumbers;
  readonly particles: ParticleSystem;
  readonly combo = new Combo(feelData.combo.windowMs);
  private readonly flashes = new Map<Phaser.GameObjects.Sprite, number>();
  private readonly squashes = new Map<Phaser.GameObjects.Sprite, { until: number; sx: number; sy: number }>();
  private hitstopEndsReal = -Infinity;
  private readonly shaker = new Shaker(feelData.shake.capPx);
  private readonly stopBudget = new StopBudget(feelData.stopBudget.ratio, feelData.stopBudget.capMs);
  private readonly shakeRng: Rng;
  private audio: AudioSink = NO_AUDIO;
  /** 이번 프레임에 전체 연출을 준 타격 수(LOD) */
  private fullUsed = 0;
  private paused = false;
  private zoomStart = -Infinity;
  private zoomAmount = 0;
  private screenFlashStart = -Infinity;
  private screenFlashMs = 0;
  private vignetteStart = -Infinity;
  private readonly screenFlash: Phaser.GameObjects.Rectangle;
  private readonly vignette: Phaser.GameObjects.Image;
  private readonly comboText: Phaser.GameObjects.BitmapText;
  private readonly muzzleAnim: string;
  /** 연출 시계(ms): 실시간으로 흐르되 완전 정지(일시정지·레벨업 선택) 중에는 멈춘다. beginFrame에서 갱신 */
  private now = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly fx: FxSystem,
    rng: Rng,
  ) {
    this.shakeRng = rng.fork('shake');
    ensureParticleTextures(scene);
    ensureVignetteTexture(scene, feelData.vignette.color);
    this.particles = new ParticleSystem(scene, feelData.particles.cap, feelData.particles.kinds as Record<string, ParticleKindData>, rng.fork('particles'));
    this.numbers = new DamageNumbers(scene, feelData.numbers as NumbersData, rng.fork('numbers'));
    this.screenFlash = scene.add
      .rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, parseColor(feelData.screenFlash.color))
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(Depth.ScreenFx)
      .setVisible(false);
    this.vignette = scene.add
      .image(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2, VIGNETTE_KEY)
      .setScrollFactor(0)
      .setDepth(Depth.ScreenFx)
      .setVisible(false);
    this.comboText = scene.add
      .bitmapText(feelData.combo.x, feelData.combo.y, PIXEL_FONT, '', 7)
      .setLetterSpacing(-1)
      .setOrigin(1, 0)
      .setScale(feelData.combo.scale)
      .setTint(parseColor(feelData.combo.color))
      .setScrollFactor(0)
      .setDepth(Depth.Ui)
      .setVisible(false);
    this.muzzleAnim = fx.cropAnim(feelData.muzzle.fx, feelData.muzzle.crop, feelData.muzzle.fps);
  }

  /** 소리 출력 연결(없으면 무음). 같은 hit 호출에서 화면과 소리를 함께 내 프레임이 어긋나지 않게 한다 */
  setAudio(sink: AudioSink): void {
    this.audio = sink;
  }

  /** 카메라에 보이는지(여백 포함). 화면 밖 타격은 시각 연출을 생략한다 */
  private onScreen(x: number, y: number): boolean {
    const v = this.scene.cameras.main.worldView;
    const m = LOD.offscreenMarginPx;
    return x >= v.x - m && x <= v.right + m && y >= v.y - m && y <= v.bottom + m;
  }

  /** 프리셋 하나를 (x, y)에서 재생. y는 연출 기준점(보통 몸통 높이) */
  hit(name: string, x: number, y: number, opt: HitOptions = {}): void {
    const p = PRESETS[name];
    if (!p) return;
    const now = this.now;
    const groundY = opt.groundY ?? y;
    const height = groundY - y;
    const visible = this.onScreen(x, y);
    // 프레임당 전체 연출 수 제한(대량 타격 때 가독성·성능). 우선순위 높은 연출은 항상
    const full = visible && lodAllows(this.fullUsed, LOD.budget, p.lod ?? 0, LOD.alwaysFrom);
    if (full) this.fullUsed++;
    const dirX = opt.dirX ?? 0;
    const dirY = opt.dirY ?? 0;

    // 시간: 전역 정지는 예산 안에서만, 슬로모는 정지가 끝난 뒤부터 센다
    let stopMs = 0;
    if (p.hitstopFrames && hitstopAllowed(now, this.hitstopEndsReal, p.hitstopMinGapMs)) {
      const ms = framesToMs(p.hitstopFrames);
      if (this.stopBudget.request(now, ms, p.hitstopForce)) {
        this.clock.hitstop(p.hitstopFrames);
        this.hitstopEndsReal = Math.max(this.hitstopEndsReal, now + ms);
        stopMs = ms;
      }
    }
    if (p.slowmoScale !== undefined && p.slowmoMs) this.clock.setScale('slowmo', p.slowmoScale, p.slowmoMs + stopMs);
    if (opt.target && p.localStopFrames) {
      opt.target.freezeUntilMs = Math.max(opt.target.freezeUntilMs, this.clock.timeMs + framesToMs(p.localStopFrames));
    }

    if (visible) {
      if (p.shakePx && p.shakeMs) this.shaker.addShake(p.shakePx, p.shakeMs, now, p.shakeStack);
      if (p.kickPx && p.kickMs) this.shaker.addKick(dirX, dirY, p.kickPx, p.kickMs, now);
      if (p.zoomPunch) this.zoomPunch(p.zoomPunch);
      if (p.screenFlashFrames) this.flashScreen(framesToMs(p.screenFlashFrames));
    }
    if (p.vignette) this.vignetteStart = now;

    const sprite = opt.target?.sprite ?? opt.sprite;
    if (sprite) {
      if (p.flashColor && p.flashFrames) this.flash(sprite, parseColor(p.flashColor), framesToMs(p.flashFrames));
      if (p.squash && visible) this.squash(sprite);
    }
    if (opt.target && p.knockbackPx && p.knockbackMs) {
      const mul = KB_BY_TIER[opt.target.tier] ?? 1;
      startKnockback(opt.target.kb, dirX, dirY, p.knockbackPx * mul, p.knockbackMs);
    }
    if (p.number && visible) this.numbers.show(p.number, x, y - 6, opt.amount);
    if (full) {
      if (p.sparks) this.particles.emit('spark', x, groundY, p.sparks, height, -dirX, -dirY);
      if (p.smoke) this.particles.emit('smoke', x, groundY, p.smoke, height);
      if (p.debris) this.particles.emit('debris', x, groundY, p.debris, height);
      if (p.crater) this.particles.emit('crater', x, groundY, p.crater);
      if (p.emit) for (const [kind, n] of Object.entries(p.emit)) this.particles.emit(kind, x, groundY, n, height);
      // 타격 장식 이펙트만 동시 상한을 받는다(총구 섬광·무기 폭발은 상한 밖)
      if (p.fx) this.fx.play(p.fx, x, y, p.fxScale ?? 1, Depth.Explosion, true);
    }
    const combo = p.combo ? this.addCombo() : 0;
    if (p.sfx) this.audio.play(p.sfx, x, y, { combo });
  }

  /** 처치: 적 등급으로 프리셋 선택(일반 → kill, 정예·보스 → kill_big) */
  kill(tier: string, x: number, y: number, opt: HitOptions = {}): void {
    this.hit(KILL_BY_TIER[tier] ?? 'kill', x, y, opt);
  }

  /** 총구 섬광 + 탄피. (x, y)는 총구 끝 월드 좌표, groundY는 쏜 사람의 발 y */
  muzzle(x: number, y: number, facing: number, groundY: number): void {
    const s = this.fx.playAnim(this.muzzleAnim, x, y, feelData.muzzle.scale, Depth.Spark);
    // flipX는 같은 사각형 안에서 좌우만 뒤집으므로 기준점도 반대편 끝으로
    s?.setOrigin(facing < 0 ? 1 : 0, 0.5).setFlipX(facing < 0);
    this.audio.play(feelData.muzzle.sfx, x, y);
    if (feelData.muzzle.casing > 0) this.particles.emit('casing', x - facing * 20, groundY, feelData.muzzle.casing, 0, -facing, -0.6);
  }

  /** 흔들림 추가(stack이면 겹칠수록 커짐). 실제 오프셋은 update에서 정수 px로 카메라에 준다 */
  shake(px: number, ms: number, stack = false): void {
    this.shaker.addShake(px, ms, this.now, stack);
  }

  zoomPunch(amount: number): void {
    const now = this.now;
    const z = feelData.zoomPunch;
    const current = this.zoomAmount * punchCurve(now - this.zoomStart, z.inMs, z.outMs);
    if (current >= amount) return;
    // 지금 줌 값에서 이어 올라가게 곡선 시작점을 당긴다(처음부터 다시 시작하면 한두 프레임 출렁임)
    this.zoomStart = now - punchRestartElapsed(current, amount, z.inMs);
    this.zoomAmount = amount;
  }

  /** 스프라이트를 color로 ms 동안 꽉 채워 칠한다. 실시간 기준 */
  flash(sprite: Phaser.GameObjects.Sprite, color: number, ms: number): void {
    if (this.intensity.flash <= 0) return;
    sprite.setTintFill(color);
    this.flashes.set(sprite, this.now + ms - FRAME_MS / 2);
  }

  flashScreen(ms: number): void {
    this.screenFlashStart = this.now;
    this.screenFlashMs = ms;
  }

  private squash(sprite: Phaser.GameObjects.Sprite): void {
    const prev = this.squashes.get(sprite);
    const sx = prev ? prev.sx : sprite.scaleX;
    const sy = prev ? prev.sy : sprite.scaleY;
    sprite.setScale(sx * feelData.squash.x, sy * feelData.squash.y);
    this.squashes.set(sprite, { until: this.now + feelData.squash.ms - FRAME_MS / 2, sx, sy });
  }

  private addCombo(): number {
    const n = this.combo.add(this.clock.timeMs);
    if (n >= feelData.combo.minShow) this.comboText.setText(`${n} COMBO`).setVisible(true).setScale(feelData.combo.scale * 1.3);
    return n;
  }

  /** 풀로 돌아간 스프라이트의 점멸·찌그러짐을 원래대로 */
  forget(sprite: Phaser.GameObjects.Sprite): void {
    if (this.flashes.delete(sprite)) sprite.clearTint();
    const sq = this.squashes.get(sprite);
    if (sq) {
      sprite.setScale(sq.sx, sq.sy);
      this.squashes.delete(sprite);
    }
  }

  /**
   * 프레임 맨 앞(타격 판정보다 먼저)에서 호출. 연출 시계를 이번 프레임 시각으로 맞춘다.
   * 끝에서 갱신하면 이번 프레임의 타격이 직전 프레임 시각을 써서 점멸이 한 프레임 짧아진다.
   */
  beginFrame(realDeltaMs: number, hardPaused: boolean): void {
    this.paused = hardPaused;
    this.fullUsed = 0;
    if (!hardPaused) this.now += Math.min(Math.max(0, realDeltaMs), MAX_REAL_DELTA_MS);
  }

  /** 프레임 끝에서 호출. dtMs: 이펙트 delta(clock.effectDeltaMs: 일시정지·슬로모 반영, 히트스톱 무시) */
  update(dtMs: number): void {
    const now = this.now;
    for (const [sprite, until] of this.flashes) {
      if (now >= until) {
        sprite.clearTint();
        this.flashes.delete(sprite);
      }
    }
    for (const [sprite, sq] of this.squashes) {
      if (now >= sq.until) {
        sprite.setScale(sq.sx, sq.sy);
        this.squashes.delete(sprite);
      }
    }
    const cam = this.scene.cameras.main;
    const z = feelData.zoomPunch;
    cam.setZoom(1 + this.zoomAmount * punchCurve(now - this.zoomStart, z.inMs, z.outMs));
    // 흔들림·킥: 정지 중에는 0(시계가 멈춰 같은 진폭으로 계속 떨리지 않게)
    const off = this.paused ? { x: 0, y: 0 } : this.shaker.sample(now, () => this.shakeRng.next(), this.intensity.shake);
    cam.setFollowOffset(-off.x, -off.y);

    const sf = (now - this.screenFlashStart) / Math.max(1, this.screenFlashMs);
    const flashAlpha = sf >= 0 && sf < 1 ? feelData.screenFlash.maxAlpha * this.intensity.flash * (1 - sf) : 0;
    this.screenFlash.setVisible(flashAlpha > 0).setAlpha(flashAlpha);

    const vk = (now - this.vignetteStart) / feelData.vignette.ms;
    const vAlpha = vk >= 0 && vk < 1 ? feelData.vignette.maxAlpha * this.intensity.flash * (1 - vk) : 0;
    this.vignette.setVisible(vAlpha > 0).setAlpha(vAlpha);

    if (this.combo.expire(this.clock.timeMs)) this.comboText.setVisible(false);
    else if (this.comboText.visible && dtMs > 0) {
      // 갱신 때 1.3배로 튄 글자를 원래 크기로
      const base = feelData.combo.scale;
      this.comboText.setScale(Math.max(base, this.comboText.scaleX - (dtMs / 1000) * base * 3));
    }

    this.numbers.update(dtMs);
    this.particles.update(dtMs);
  }

  /** 새 판: 진행 중 연출 정리 */
  reset(): void {
    for (const sprite of [...this.flashes.keys(), ...this.squashes.keys()]) this.forget(sprite);
    this.numbers.clear();
    this.particles.clear();
    this.combo.expire(Infinity);
    this.comboText.setVisible(false);
    this.zoomAmount = 0;
    this.shaker.reset();
    this.scene.cameras.main.setZoom(1).setFollowOffset(0, 0);
  }
}

const VIGNETTE_KEY = 'pt_vignette';

/** 화면 가장자리만 붉은 비네팅(가운데 투명). 도트 느낌을 살리려고 4px 단위 계단 */
function ensureVignetteTexture(scene: Phaser.Scene, color: string): void {
  if (scene.textures.exists(VIGNETTE_KEY)) return;
  const w = LOGICAL_WIDTH / 4;
  const h = LOGICAL_HEIGHT / 4;
  const tex = scene.textures.createCanvas(VIGNETTE_KEY, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  if (!tex) throw new Error('비네팅 텍스처 생성 실패');
  const ctx = tex.getContext();
  const rgb = parseColor(color);
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w - 0.5;
      const ny = (y + 0.5) / h - 0.5;
      const d = Math.hypot(nx * 1.1, ny * 1.6) / 0.72;
      const a = Math.min(1, Math.max(0, (d - 0.55) / 0.45));
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(${r},${g},${b},${(Math.round(a * 4) / 4).toFixed(2)})`;
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }
  }
  tex.refresh();
}
