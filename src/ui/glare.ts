import * as Phaser from 'phaser';
import feelData from '../data/feel.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';

// 눈부심(기술 발동·작전 성공): 한 점에서 터지는 빛 — 화면 번쩍임 + 빛 덩어리 + 방사 광선 + 가로 빛줄기.
// 수치는 feel.json glare. 번쩍임은 한 번 올라갔다 천천히 꺼지고(깜빡이지 않음) 점멸 강도 설정(k)을 따른다.

export interface GlareCfg {
  /** 빛 색 */
  color: string;
  /** 화면 전체 번쩍임의 최대 알파 */
  veil: number;
  /** 빛 덩어리 크기(px 지름) */
  core: number;
  /** 방사 광선 수와 길이(px) */
  rays: number;
  rayLen: number;
  /** 가로 빛줄기 길이(px, 0이면 없음) */
  streak: number;
  /** 전체 길이 */
  ms: number;
}

const CORE = 'glare_core';
const RAY = 'glare_ray';

function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(CORE)) {
    const c = scene.textures.createCanvas(CORE, 128, 128);
    if (c) {
      const g = c.context.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.context.fillStyle = g;
      c.context.fillRect(0, 0, 128, 128);
      c.refresh();
    }
  }
  if (!scene.textures.exists(RAY)) {
    // 한쪽 끝(왼쪽)이 밝고 끝으로 갈수록 가늘고 흐려지는 광선
    const c = scene.textures.createCanvas(RAY, 128, 16);
    if (c) {
      const ctx = c.context;
      for (let x = 0; x < 128; x++) {
        const k = 1 - x / 128;
        const half = 1 + 6 * k;
        const grad = ctx.createLinearGradient(0, 8 - half, 0, 8 + half);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, `rgba(255,255,255,${(k * k).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, 8 - half, 1, half * 2);
      }
      c.refresh();
    }
  }
}

let lastAt = -Infinity;

/**
 * (x, y)에서 눈부심 한 번. k = 점멸 강도(0이면 화면 번쩍임 없이 빛만 약하게).
 * 너무 잦으면(feel.json glare.minGapMs) 건너뜀 — 연달아 번쩍이지 않게
 */
export function playGlare(scene: Phaser.Scene, x: number, y: number, cfg: GlareCfg, k: number, depth = -5): void {
  const now = scene.time.now;
  if (now - lastAt < feelData.glare.minGapMs && now >= lastAt) return;
  lastAt = now;
  ensureTextures(scene);
  const color = Phaser.Display.Color.HexStringToColor(cfg.color).color;
  const add = Phaser.BlendModes.ADD;
  const made: Phaser.GameObjects.GameObject[] = [];
  const done = () => made.forEach((o) => o.destroy());

  if (k > 0 && cfg.veil > 0) {
    // 첫 프레임에 가장 밝고 천천히 꺼짐(프레임이 밀려도 번쩍임은 보이게)
    const veil = scene.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0xffffff, cfg.veil * k).setOrigin(0).setDepth(depth).setBlendMode(add);
    made.push(veil);
    scene.tweens.add({ targets: veil, fillAlpha: 0, duration: cfg.ms * 0.6, ease: 'Quad.Out' });
  }
  const dim = 0.45 + 0.55 * k;
  // 빛 덩어리: 색 번짐(크게) + 흰 심(작게)
  const halo = scene.add.image(x, y, CORE).setTint(color).setBlendMode(add).setDepth(depth).setScale((cfg.core / 128) * 0.45).setAlpha(0.95 * dim);
  const hot = scene.add.image(x, y, CORE).setBlendMode(add).setDepth(depth).setScale((cfg.core / 128) * 0.25).setAlpha(dim);
  made.push(halo, hot);
  // 크기는 빠르게 퍼지고(Cubic.Out) 밝기는 고르게 꺼짐: 번쩍인 뒤 잔광이 남게
  scene.tweens.add({ targets: halo, scale: cfg.core / 128, duration: cfg.ms, ease: 'Cubic.Out' });
  scene.tweens.add({ targets: halo, alpha: 0, duration: cfg.ms });
  scene.tweens.add({ targets: hot, scale: (cfg.core / 128) * 0.5, duration: cfg.ms * 0.6, ease: 'Cubic.Out' });
  scene.tweens.add({ targets: hot, alpha: 0, duration: cfg.ms * 0.6 });
  // 방사 광선: 길고 짧은 것을 번갈아, 전체가 천천히 돌며 사라짐
  const spin = scene.add.container(x, y).setDepth(depth);
  made.push(spin);
  const off = Math.random() * Math.PI;
  for (let i = 0; i < cfg.rays; i++) {
    const len = cfg.rayLen * (i % 2 === 0 ? 1 : 0.6);
    const ray = scene.add
      .image(0, 0, RAY)
      .setOrigin(0, 0.5)
      .setRotation(off + (i / cfg.rays) * Math.PI * 2)
      .setTint(i % 2 === 0 ? 0xffffff : color)
      .setBlendMode(add)
      .setScale((len / 128) * 0.45, 1.2)
      .setAlpha(0.9 * dim);
    spin.add(ray);
    scene.tweens.add({ targets: ray, scaleX: len / 128, scaleY: 0.5, duration: cfg.ms * 0.85, ease: 'Cubic.Out' });
    scene.tweens.add({ targets: ray, alpha: 0, duration: cfg.ms * 0.85, ease: 'Quad.In' });
  }
  scene.tweens.add({ targets: spin, rotation: 0.35, duration: cfg.ms, ease: 'Sine.Out' });
  // 가로 빛줄기(렌즈에 번진 빛): 양쪽으로 길게 뻗었다 가늘어짐
  if (cfg.streak > 0) {
    for (const dir of [0, Math.PI]) {
      const s = scene.add.image(x, y, RAY).setOrigin(0, 0.5).setRotation(dir).setTint(color).setBlendMode(add).setDepth(depth).setScale((cfg.streak / 128) * 0.5, 2.2).setAlpha(0.85 * dim);
      made.push(s);
      scene.tweens.add({ targets: s, scaleX: cfg.streak / 128, scaleY: 0.25, duration: cfg.ms * 0.7, ease: 'Cubic.Out' });
      scene.tweens.add({ targets: s, alpha: 0, duration: cfg.ms * 0.7 });
    }
  }
  scene.time.delayedCall(cfg.ms + 60, done);
}
