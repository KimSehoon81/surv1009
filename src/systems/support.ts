// 전투 지원 기믹(2026-11-14): 수송기 보급 투하(낙하산 상자 → 주우면 보상)와 우방군 지원 분대(잠시 곁에서 사격).
// 규칙은 core/support, 수치는 data/support.json. 보상 효과는 카드 효과 핸들러(systems/effects)를 그대로 씀
import * as Phaser from 'phaser';
import support from '../data/support.json';
import { manifest } from '../assets/manifest';
import { Depth } from '../config/depth';
import { due, dropPoint, formationSlot, pickWeighted } from '../core/support';
import type { Rng } from '../core/rng';
import type { Enemy } from '../entities/Enemy';
import { allyMark } from '../ui/factionMark';
import { registerUnitAnims } from './anims';
import { t } from '../i18n';

const AD = support.airdrop;
const SQ = support.squad;
const CRATE_KEY = 'support_crate';

export interface SupportHooks {
  rng: Rng;
  player(): { x: number; y: number; facing: 1 | -1 };
  /** 사거리 안 가장 가까운 지상 적 */
  nearestEnemy(x: number, y: number, range: number): Enemy | null;
  damageEnemy(e: Enemy, mult: number, dirX: number, dirY: number): void;
  runEffects(list: readonly { effect: string; params: Record<string, unknown> }[]): void;
  fx(name: string, x: number, y: number, scale: number): void;
  audio(cue: string, x?: number, y?: number): void;
  toast(msg: string, color: string): void;
  feel(preset: string, x: number, y: number): void;
}

interface Crate {
  x: number;
  y: number;
  landAt: number;
  expireAt: number;
  sprite: Phaser.GameObjects.Image;
  chute: Phaser.GameObjects.Sprite | null;
}

interface Soldier {
  sprite: Phaser.GameObjects.Sprite;
  slot: number;
  nextShot: number;
  anims: { idle?: string; move?: string };
}

export class SupportSystem {
  private crates: Crate[] = [];
  private squad: Soldier[] = [];
  private squadUntil = 0;
  private leaving = false;
  private lastDrop: number | null = null;
  private lastSquad: number | null = null;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly tracers: Phaser.GameObjects.Graphics;
  private tracerList: { x1: number; y1: number; x2: number; y2: number; until: number }[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly h: SupportHooks,
  ) {
    this.gfx = scene.add.graphics().setDepth(Depth.Decal + 2);
    this.tracers = scene.add.graphics().setDepth(Depth.Player + 2);
    ensureCrateTexture(scene);
  }

  get activeCrates(): number {
    return this.crates.length;
  }
  get squadSize(): number {
    return this.squad.length;
  }

  update(nowMs: number, dtMs: number): void {
    const sec = nowMs / 1000;
    const dropAt = due(sec, AD.firstSec, AD.everySec, this.lastDrop);
    if (dropAt !== null) {
      this.lastDrop = dropAt;
      if (this.crates.length < AD.maxActive) this.drop(nowMs);
    }
    const squadAt = due(sec, SQ.firstSec, SQ.everySec, this.lastSquad);
    if (squadAt !== null) {
      this.lastSquad = squadAt;
      if (this.squad.length === 0) this.callSquad(nowMs);
    }
    this.updateCrates(nowMs);
    if (dtMs > 0) this.updateSquad(nowMs, dtMs);
    this.drawTracers(nowMs);
  }

  /** 수송기가 지나가며 낙하산 상자 투하: 떨어지는 동안 착지 지점 표시 */
  drop(nowMs: number): void {
    const p = this.h.player();
    const [lo = 130, hi = lo] = AD.distance;
    const at = dropPoint(this.h.rng, p.x, p.y, lo, hi);
    const fxKey = manifest.fx('supply_drop').key;
    if (this.scene.textures.exists(fxKey)) {
      const plane = this.scene.add.sprite(at.x - 520, at.y - 240, fxKey, 0).setDepth(Depth.Player + 20).setScale(1.2);
      this.scene.tweens.add({ targets: plane, x: at.x + 520, y: at.y - 260, duration: 2600, onComplete: () => plane.destroy() });
    }
    const crate = this.scene.add.image(at.x, at.y - 220, CRATE_KEY).setOrigin(0.5, 1).setDepth(Depth.Player + 10);
    const chute = this.scene.textures.exists(fxKey) ? this.scene.add.sprite(at.x, at.y - 240, fxKey, 1).setOrigin(0.5, 1).setDepth(Depth.Player + 10).setScale(0.6) : null;
    const fall = { k: 0 };
    this.scene.tweens.add({
      targets: fall,
      k: 1,
      duration: AD.fallMs,
      delay: 400,
      onUpdate: () => {
        const y = at.y - 220 * (1 - fall.k);
        crate.setY(y);
        chute?.setPosition(at.x + Math.sin(fall.k * 9) * 3, y - 12).setFrame(fall.k > 0.5 ? 2 : 1);
      },
    });
    this.crates.push({ x: at.x, y: at.y, landAt: nowMs + AD.fallMs + 400, expireAt: nowMs + AD.fallMs + 400 + AD.lifeMs, sprite: crate, chute });
    this.h.audio('fighter_pass');
    this.h.toast(t('support.dropIncoming'), '#7fd8ff');
  }

  private updateCrates(nowMs: number): void {
    const g = this.gfx.clear();
    const p = this.h.player();
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i] as Crate;
      if (nowMs < c.landAt) {
        // 착지 지점: 아군 범위 표시(청록 원 + 조준 눈금)
        g.lineStyle(1, 0x7fd8ff, 0.8).strokeEllipse(c.x, c.y, 34, 22);
        allyMark(g, c.x, c.y, 17, 0x7fd8ff, 0.8);
        continue;
      }
      if (c.chute) {
        // 착지: 낙하산은 접혀 사라짐
        const chute = c.chute;
        c.chute = null;
        this.scene.tweens.add({ targets: chute, alpha: 0, scaleY: 0.2, duration: 400, onComplete: () => chute.destroy() });
        c.sprite.setDepth(Depth.Decal + 3);
        this.h.fx('dust', c.x, c.y - 2, 0.5);
        this.h.audio('flare_pop', c.x, c.y);
      }
      const left = c.expireAt - nowMs;
      c.sprite.setVisible(left > 5000 || Math.floor(nowMs / 150) % 2 === 0);
      // 주우라는 표시: 위에서 까딱이는 삼각형
      const bob = Math.sin(nowMs / 160) * 2;
      g.fillStyle(0x7fd8ff, 0.95).fillTriangle(c.x - 4, c.y - 26 + bob, c.x + 4, c.y - 26 + bob, c.x, c.y - 20 + bob);
      if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 <= (AD.radius + 10) ** 2) {
        this.pickup(c);
        this.crates.splice(i, 1);
      } else if (left <= 0) {
        c.sprite.destroy();
        this.crates.splice(i, 1);
      }
    }
  }

  private pickup(c: Crate): void {
    const r = pickWeighted(this.h.rng, AD.rewards);
    if (r) this.h.runEffects(r.effects as { effect: string; params: Record<string, unknown> }[]);
    this.h.feel('card_success', c.x, c.y - 10);
    this.h.audio('buff_up', c.x, c.y);
    this.h.toast(t('support.got', { what: t(`support.reward.${r?.id ?? 'medkit'}`) }), '#6fd06f');
    const fxKey = manifest.fx('supply_drop').key;
    if (this.scene.textures.exists(fxKey)) {
      const s = this.scene.add.sprite(c.x, c.y - 10, fxKey, 4).setDepth(Depth.Player + 5);
      this.scene.time.delayedCall(120, () => s.setFrame(5));
      this.scene.tweens.add({ targets: s, alpha: 0, y: c.y - 30, duration: 500, delay: 200, onComplete: () => s.destroy() });
    }
    c.sprite.destroy();
  }

  /** 우방군 지원 분대: 화면 밖에서 뛰어 들어와 플레이어 곁에서 lifeMs 동안 사격, 끝나면 경례하듯 떠남 */
  callSquad(nowMs: number): void {
    const p = this.h.player();
    const units = SQ.units.filter((id) => manifest.sheet(id, 'move_slow').path !== null);
    if (units.length === 0) return;
    const fromLeft = this.h.rng.next() < 0.5;
    units.forEach((id, i) => {
      const anims = registerUnitAnims(this.scene, id);
      const sprite = this.scene.add
        .sprite(p.x + (fromLeft ? -SQ.enterPx : SQ.enterPx) - i * 18, p.y + (i - 1) * 20, manifest.sheetKey(id, 'move_slow'), 0)
        .setOrigin(manifest.anchor.x, manifest.anchor.y)
        .setScale(0.9);
      this.squad.push({ sprite, slot: i, nextShot: nowMs + 600 + i * 200, anims: { idle: anims.keys.idle, move: anims.keys.move_fast ?? anims.keys.move_slow } });
    });
    this.squadUntil = nowMs + SQ.lifeMs;
    this.leaving = false;
    this.h.toast(t('support.squadArrive', { sec: Math.round(SQ.lifeMs / 1000) }), '#7fd8ff');
    this.h.audio('buff_up');
  }

  private updateSquad(nowMs: number, dtMs: number): void {
    if (this.squad.length === 0) return;
    const p = this.h.player();
    if (!this.leaving && nowMs >= this.squadUntil) {
      this.leaving = true;
      this.h.toast(t('support.squadLeave'), '#b0a890');
    }
    const g = this.gfx;
    for (let i = this.squad.length - 1; i >= 0; i--) {
      const s = this.squad[i] as Soldier;
      const spr = s.sprite;
      // 목표 자리: 머무는 동안 플레이어 둘레, 떠날 때는 화면 밖으로
      const slot = formationSlot(s.slot, SQ.units.length, SQ.ring, p.facing);
      const tx = this.leaving ? spr.x + (spr.x >= p.x ? 1 : -1) * 600 : p.x + slot.x;
      const ty = this.leaving ? spr.y : p.y + slot.y;
      const dx = tx - spr.x;
      const dy = ty - spr.y;
      const d = Math.hypot(dx, dy);
      const step = (SQ.speed * dtMs) / 1000;
      const moving = d > 4;
      if (moving) spr.setPosition(spr.x + (dx / d) * Math.min(step, d), spr.y + (dy / d) * Math.min(step, d));
      const want = moving ? s.anims.move : s.anims.idle;
      if (want && spr.anims.currentAnim?.key !== want) spr.play(want);
      spr.setDepth(Depth.Player - 2 + (spr.y - p.y) * 0.001);
      if (this.leaving) {
        spr.setAlpha(Math.max(0, spr.alpha - dtMs / 1500));
        if (spr.alpha <= 0) {
          spr.destroy();
          this.squad.splice(i, 1);
        }
        continue;
      }
      // 아군 표시: 발밑 청록 원 눈금 + 머리 위 작은 청록 원(주인공과 구분)
      allyMark(g, spr.x, spr.y - 2, 9, 0x7fd8ff, 0.7);
      g.lineStyle(2, 0x7fd8ff, 0.9).strokeCircle(spr.x, spr.y - 62, 3);
      if (nowMs < s.nextShot) continue;
      const e = this.h.nearestEnemy(spr.x, spr.y - 20, SQ.range);
      if (!e) continue;
      s.nextShot = nowMs + SQ.fireMs * (0.85 + this.h.rng.next() * 0.3);
      spr.setFlipX(e.x < spr.x);
      const mx = spr.x + (e.x < spr.x ? -16 : 16);
      const my = spr.y - 34;
      this.tracerList.push({ x1: mx, y1: my, x2: e.x, y2: e.y - 24, until: nowMs + 70 });
      const len = Math.hypot(e.x - mx, e.y - my) || 1;
      this.h.damageEnemy(e, SQ.damageMul, (e.x - mx) / len, (e.y - my) / len);
      this.h.audio('shot', mx, my);
    }
  }

  private drawTracers(nowMs: number): void {
    const g = this.tracers.clear();
    this.tracerList = this.tracerList.filter((tr) => tr.until > nowMs);
    for (const tr of this.tracerList) g.lineStyle(2, 0xfff4b0, 0.9).lineBetween(tr.x1, tr.y1, tr.x2, tr.y2);
  }

  destroy(): void {
    for (const c of this.crates) {
      c.sprite.destroy();
      c.chute?.destroy();
    }
    for (const s of this.squad) s.sprite.destroy();
    this.crates = [];
    this.squad = [];
  }
}

/** 보급 상자 도트(나무 상자 + 흰 별 무늬), 그림 파일 없이 한 번 만듦 */
function ensureCrateTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(CRATE_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x2a1a0e, 1).fillRect(0, 2, 24, 18);
  g.fillStyle(0x8a6034, 1).fillRect(1, 3, 22, 16);
  g.fillStyle(0x6a4424, 1).fillRect(1, 8, 22, 1).fillRect(1, 13, 22, 1).fillRect(6, 3, 1, 16).fillRect(17, 3, 1, 16);
  g.fillStyle(0xf0ece0, 1).fillTriangle(12, 6, 9, 14, 15, 14).fillTriangle(8, 9, 16, 9, 12, 13);
  g.fillStyle(0x4a6a3a, 1).fillRect(0, 0, 24, 3);
  g.generateTexture(CRATE_KEY, 24, 20);
  g.destroy();
}
