// 고지 점령 기믹(2026-11-16): 전장에 점령 지점(원)이 생기고, 안에서 버티면 깃대의 태극기가 올라가 다 오르면 점령(보상).
// 규칙은 core/outpost, 수치는 data/outpost.json. 보상 효과는 카드 효과 핸들러(systems/effects)를 그대로 씀
import * as Phaser from 'phaser';
import data from '../data/outpost.json';
import { Depth } from '../config/depth';
import { insideOutpost, outpostRatio, stepOutpost, type OutpostCfg, type OutpostState } from '../core/outpost';
import { due, dropPoint } from '../core/support';
import type { Rng } from '../core/rng';
import { t } from '../i18n';
import { uiText } from '../ui/text';

const CFG: OutpostCfg = { radius: data.radius, captureMs: data.captureMs, decayMul: data.decayMul, lifeMs: data.lifeMs };
const hex = (s: string): number => Phaser.Display.Color.HexStringToColor(s).color;
const RING = hex(data.colors.ring);
const FILL = hex(data.colors.fill);
const DONE = hex(data.colors.done);

export interface OutpostHooks {
  rng: Rng;
  player(): { x: number; y: number };
  /** 새 지점을 내도 되는가(보스전·결과 중에는 아님) */
  canSpawn(): boolean;
  /** 장애물 안이면 밖으로 밀어낸 자리 */
  place(x: number, y: number): { x: number; y: number };
  runEffects(list: readonly { effect: string; params: Record<string, unknown> }[]): void;
  /** 주변 적에게 피해(공격력 배수) */
  blast(x: number, y: number, radius: number, mult: number): void;
  feel(preset: string, x: number, y: number): void;
  glare(kind: string, x: number, y: number): void;
  toast(msg: string, color: string): void;
  stamp(title: string, sub: string): void;
  audio(cue: string, x?: number, y?: number): void;
}

interface Post extends OutpostState {
  ring: Phaser.GameObjects.Graphics;
  pole: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  /** 점령한 시각(깃발이 남아 있는 동안) */
  doneAt: number | null;
  /** 사라지는 중 */
  fading: boolean;
  inside: boolean;
}

export class OutpostSystem {
  private posts: Post[] = [];
  private last: number | null = null;
  captured = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly h: OutpostHooks,
  ) {}

  /** 아직 점령하지 않은 지점(화면 밖 방향 표시) */
  spots(): { x: number; y: number }[] {
    return this.posts.filter((p) => p.doneAt === null && !p.fading).map((p) => ({ x: p.x, y: p.y }));
  }

  update(nowMs: number, dtMs: number): void {
    const at = due(nowMs / 1000, data.firstSec, data.everySec, this.last);
    if (at !== null) {
      this.last = at;
      if (this.spots().length < data.maxActive && this.h.canSpawn()) this.spawn(nowMs);
    }
    const pl = this.h.player();
    for (const p of this.posts) {
      if (p.fading) continue;
      if (p.doneAt === null) {
        p.inside = insideOutpost(p, pl.x, pl.y, CFG.radius);
        const r = stepOutpost(p, p.inside, dtMs, nowMs, CFG);
        p.progressMs = r.progressMs;
        if (r.step === 'captured') this.capture(p, nowMs);
        else if (r.step === 'expired') {
          this.h.toast(t('battle.outpost.lost'), '#b0a890');
          this.fade(p);
        }
      } else if (nowMs - p.doneAt >= data.keepMs) this.fade(p);
      this.draw(p, nowMs);
    }
    this.posts = this.posts.filter((p) => p.ring.active);
  }

  /** 점령 지점 하나 세우기(디버그·테스트에서도 부름) */
  spawn(nowMs: number): { x: number; y: number } {
    const pl = this.h.player();
    const [lo = 170, hi = lo] = data.distance;
    const raw = dropPoint(this.h.rng, pl.x, pl.y, lo, hi);
    const at = this.h.place(raw.x, raw.y);
    const ring = this.scene.add.graphics().setDepth(Depth.Decal + 3);
    const pole = this.scene.add.graphics().setDepth(Depth.Player - 1);
    const label = this.scene.add
      .text(at.x, at.y - data.poleHeight - 16, '', { ...uiText(12, '#ffffff'), stroke: '#0a0604', strokeThickness: 3 })
      .setOrigin(0.5)
      .setDepth(Depth.DamageText - 1);
    const post: Post = { x: at.x, y: at.y, bornMs: nowMs, progressMs: 0, ring, pole, label, doneAt: null, fading: false, inside: false };
    this.posts.push(post);
    for (const o of [ring, pole, label]) o.setAlpha(0);
    this.scene.tweens.add({ targets: [ring, pole, label], alpha: 1, duration: 350 });
    this.h.toast(t('battle.outpost.spawn', { sec: Math.round(data.captureMs / 1000) }), '#7fd8ff');
    this.h.audio('buff_up');
    this.draw(post, nowMs);
    return at;
  }

  private capture(p: Post, nowMs: number): void {
    p.doneAt = nowMs;
    this.captured++;
    this.h.runEffects(data.rewards);
    this.h.blast(p.x, p.y, data.blast.radius, data.blast.mult);
    this.h.feel('outpost_capture', p.x, p.y);
    this.h.glare('outpost', p.x, p.y - data.poleHeight);
    this.h.stamp(t('battle.outpost.captured'), t('battle.outpost.capturedSub', { sec: data.buffSec }));
  }

  private fade(p: Post): void {
    p.fading = true;
    this.scene.tweens.add({
      targets: [p.ring, p.pole, p.label],
      alpha: 0,
      duration: 450,
      onComplete: () => {
        p.ring.destroy();
        p.pole.destroy();
        p.label.destroy();
      },
    });
  }

  private draw(p: Post, nowMs: number): void {
    const k = outpostRatio(p, CFG);
    const done = p.doneAt !== null;
    const R = CFG.radius;
    const g = p.ring.clear();
    const color = done ? DONE : p.inside ? DONE : RING;
    const pulse = 0.5 + 0.5 * Math.sin(nowMs / 260);
    // 바닥: 옅은 원 + 도는 점선 테두리(안에 들어가면 금색)
    g.fillStyle(done ? DONE : FILL, done ? 0.1 : 0.1 + 0.05 * pulse).fillCircle(p.x, p.y, R);
    const segs = 24;
    const spin = (nowMs / 4000) * Math.PI * 2;
    g.lineStyle(2, color, done ? 0.5 : 0.75);
    for (let i = 0; i < segs; i++) {
      const a0 = spin + (i / segs) * Math.PI * 2;
      g.beginPath();
      g.arc(p.x, p.y, R, a0, a0 + (Math.PI * 2) / segs / 2);
      g.strokePath();
    }
    // 진행 고리: 위(12시)부터 시계 방향으로 채워짐
    if (k > 0 && !done) {
      g.lineStyle(5, 0x0a0604, 0.6);
      g.beginPath();
      g.arc(p.x, p.y, R - 6, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      g.strokePath();
      g.lineStyle(3, DONE, 1);
      g.beginPath();
      g.arc(p.x, p.y, R - 6, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      g.strokePath();
    }
    // 깃대 + 태극기(진행만큼 올라감, 다 오르면 펄럭임)
    const f = p.pole.clear();
    const H = data.poleHeight;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    f.fillStyle(0x000000, 0.25).fillEllipse(x, y + 1, 24, 8);
    f.fillStyle(0x3a2e24, 1).fillRect(x - 7, y - 4, 14, 6);
    f.fillStyle(0x6a5a48, 1).fillRect(x - 6, y - 4, 12, 3);
    f.fillStyle(0x1a0a06, 1).fillRect(x - 3, y - H - 1, 6, H);
    f.fillStyle(0xb08a50, 1).fillRect(x - 2, y - H, 4, H - 3);
    f.fillStyle(0xd8b070, 1).fillRect(x - 2, y - H, 1, H - 3);
    f.fillStyle(0x1a0a06, 1).fillRect(x - 4, y - H - 6, 8, 6);
    f.fillStyle(0xffd34d, 1).fillRect(x - 3, y - H - 5, 6, 4);
    // 깃발은 2배 도트(멀리서도 목표가 보이게): 흰 바탕 + 태극 + 네 귀 괘, 점령 뒤에는 오른쪽 절반이 물결
    const u = 2;
    const w = done ? Math.floor(nowMs / 160) % 2 : 0;
    const fx = x + 2;
    const fy = Math.round(y - 13 * u - 8 - (H - 13 * u - 10) * k);
    const px = (dx: number, dy: number, pw: number, ph: number, color: number) => f.fillStyle(color, 1).fillRect(fx + dx * u, fy + dy * u, pw * u, ph * u);
    f.fillStyle(0x1a0a06, 1).fillRect(fx - 1, fy - 1, 20 * u + 2, 13 * u + 2 + u);
    px(0, 0, 10, 13, 0xf4f0e6);
    px(10, w, 10, 13, 0xf4f0e6);
    px(8, 3, 5, 3, 0xd83a3a);
    px(8, 6, 5, 3, 0x2a4ab8);
    px(2, 2, 3, 1, 0x1a1a1a);
    px(2, 10, 3, 1, 0x1a1a1a);
    px(15, 2 + w, 3, 1, 0x1a1a1a);
    px(15, 10 + w, 3, 1, 0x1a1a1a);
    // 머리 위 글자: 밖 = 들어오라는 안내, 안 = 남은 초, 점령 뒤 = 점령 표시
    const left = Math.max(0, (CFG.captureMs - p.progressMs) / 1000);
    p.label
      .setText(done ? t('battle.outpost.doneLabel') : p.inside ? t('battle.outpost.holding', { sec: left.toFixed(1) }) : t('battle.outpost.label'))
      .setColor(done || p.inside ? '#ffe14d' : '#7fd8ff');
  }

  destroy(): void {
    for (const p of this.posts) {
      p.ring.destroy();
      p.pole.destroy();
      p.label.destroy();
    }
    this.posts = [];
  }
}
