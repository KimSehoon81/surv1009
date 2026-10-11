import * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import { Combo, framesToMs, parseColor, punchCurve, shakeIntensity, startKnockback, type Knockback } from '../core/feel';
import type { Rng } from '../core/rng';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Depth } from '../config/depth';
import type { GameClock } from './clock';
import { DamageNumbers, type NumbersData } from './damageNumbers';
import type { FxSystem } from './fx';
import { ParticleSystem, ensureParticleTextures, type ParticleKindData } from './particles';
import { PIXEL_FONT } from '../ui/pixelFont';

/** feel.json 프리셋. 없는 항목은 연출하지 않는다 */
export interface FeelPreset {
  hitstopFrames?: number;
  hitstopMinGapMs?: number;
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

export interface HitOptions {
  /** 점멸·찌그러짐 대상 */
  sprite?: Phaser.GameObjects.Sprite;
  /** 넉백을 받을 개체의 상태(이동은 개체 쪽 update에서 전투 시계로) */
  knockback?: Knockback;
  /** 맞은 쪽 등급(넉백 배율) */
  tier?: string;
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
const FX_FPS = feelData.fxFps as Record<string, number>;

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
  private shakeUntil = -Infinity;
  private shakePx = 0;
  private zoomStart = -Infinity;
  private zoomAmount = 0;
  private screenFlashStart = -Infinity;
  private screenFlashMs = 0;
  private vignetteStart = -Infinity;
  private readonly screenFlash: Phaser.GameObjects.Rectangle;
  private readonly vignette: Phaser.GameObjects.Image;
  private readonly comboText: Phaser.GameObjects.BitmapText;
  private readonly muzzleAnim: string;
  private nowReal = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    private readonly fx: FxSystem,
    rng: Rng,
  ) {
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

  /** 프리셋 하나를 (x, y)에서 재생. y는 연출 기준점(보통 몸통 높이) */
  hit(name: string, x: number, y: number, opt: HitOptions = {}): void {
    const p = PRESETS[name];
    if (!p) return;
    const now = this.nowReal;
    const groundY = opt.groundY ?? y;
    const height = groundY - y;

    if (p.hitstopFrames && now >= this.hitstopEndsReal + (p.hitstopMinGapMs ?? 0)) {
      this.clock.hitstop(p.hitstopFrames);
      this.hitstopEndsReal = Math.max(this.hitstopEndsReal, now + framesToMs(p.hitstopFrames));
    }
    if (p.slowmoScale !== undefined && p.slowmoMs) this.clock.setScale('slowmo', p.slowmoScale, p.slowmoMs);
    if (p.shakePx && p.shakeMs) this.shake(p.shakePx, p.shakeMs);
    if (p.zoomPunch) this.zoomPunch(p.zoomPunch);
    if (p.screenFlashFrames) this.flashScreen(framesToMs(p.screenFlashFrames));
    if (p.vignette) this.vignetteStart = now;

    if (opt.sprite) {
      if (p.flashColor && p.flashFrames) this.flash(opt.sprite, parseColor(p.flashColor), framesToMs(p.flashFrames));
      if (p.squash) this.squash(opt.sprite);
    }
    if (opt.knockback && p.knockbackPx && p.knockbackMs) {
      const mul = KB_BY_TIER[opt.tier ?? 'normal'] ?? 1;
      startKnockback(opt.knockback, opt.dirX ?? 0, opt.dirY ?? 0, p.knockbackPx * mul, p.knockbackMs);
    }
    if (p.number) this.numbers.show(p.number, x, y - 6, opt.amount);
    if (p.sparks) this.particles.emit('spark', x, groundY, p.sparks, height, -(opt.dirX ?? 0), -(opt.dirY ?? 0));
    if (p.smoke) this.particles.emit('smoke', x, groundY, p.smoke, height);
    if (p.debris) this.particles.emit('debris', x, groundY, p.debris, height);
    if (p.crater) this.particles.emit('crater', x, groundY, p.crater);
    if (p.fx) this.fx.play(p.fx, x, y, p.fxScale ?? 1, Depth.Explosion, FX_FPS[p.fx]);
    if (p.combo) this.addCombo();
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
    if (feelData.muzzle.casing > 0) this.particles.emit('casing', x - facing * 20, groundY, feelData.muzzle.casing, 0, -facing, -0.6);
  }

  shake(px: number, ms: number): void {
    const now = this.nowReal;
    const mul = this.intensity.shake;
    if (mul <= 0) return;
    // 약한 흔들림이 진행 중인 강한 흔들림을 끊지 않게
    if (now < this.shakeUntil && px < this.shakePx) return;
    const i = shakeIntensity(px, LOGICAL_WIDTH, LOGICAL_HEIGHT, mul);
    this.scene.cameras.main.shake(ms, new Phaser.Math.Vector2(i.x, i.y), true);
    this.shakeUntil = now + ms;
    this.shakePx = px;
  }

  zoomPunch(amount: number): void {
    const now = this.nowReal;
    const z = feelData.zoomPunch;
    const current = this.zoomAmount * punchCurve(now - this.zoomStart, z.inMs, z.outMs);
    if (current >= amount) return;
    this.zoomStart = now;
    this.zoomAmount = amount;
  }

  /** 스프라이트를 color로 ms 동안 꽉 채워 칠한다. 실시간 기준 */
  flash(sprite: Phaser.GameObjects.Sprite, color: number, ms: number): void {
    if (this.intensity.flash <= 0) return;
    sprite.setTintFill(color);
    this.flashes.set(sprite, this.nowReal + ms);
  }

  flashScreen(ms: number): void {
    this.screenFlashStart = this.nowReal;
    this.screenFlashMs = ms;
  }

  private squash(sprite: Phaser.GameObjects.Sprite): void {
    const prev = this.squashes.get(sprite);
    const sx = prev ? prev.sx : sprite.scaleX;
    const sy = prev ? prev.sy : sprite.scaleY;
    sprite.setScale(sx * feelData.squash.x, sy * feelData.squash.y);
    this.squashes.set(sprite, { until: this.nowReal + feelData.squash.ms, sx, sy });
  }

  private addCombo(): void {
    const n = this.combo.add(this.clock.timeMs);
    if (n < feelData.combo.minShow) return;
    this.comboText.setText(`${n} COMBO`).setVisible(true).setScale(feelData.combo.scale * 1.3);
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

  /** nowRealMs: scene.time.now, dtMs: 이펙트 delta(clock.effectDeltaMs: 일시정지·슬로모 반영, 히트스톱 무시) */
  update(nowRealMs: number, dtMs: number): void {
    this.nowReal = nowRealMs;
    for (const [sprite, until] of this.flashes) {
      if (nowRealMs >= until) {
        sprite.clearTint();
        this.flashes.delete(sprite);
      }
    }
    for (const [sprite, sq] of this.squashes) {
      if (nowRealMs >= sq.until) {
        sprite.setScale(sq.sx, sq.sy);
        this.squashes.delete(sprite);
      }
    }
    const z = feelData.zoomPunch;
    this.scene.cameras.main.setZoom(1 + this.zoomAmount * punchCurve(nowRealMs - this.zoomStart, z.inMs, z.outMs));

    const sf = (nowRealMs - this.screenFlashStart) / Math.max(1, this.screenFlashMs);
    const flashAlpha = sf >= 0 && sf < 1 ? feelData.screenFlash.maxAlpha * this.intensity.flash * (1 - sf) : 0;
    this.screenFlash.setVisible(flashAlpha > 0).setAlpha(flashAlpha);

    const vk = (nowRealMs - this.vignetteStart) / feelData.vignette.ms;
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
    this.scene.cameras.main.setZoom(1);
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
