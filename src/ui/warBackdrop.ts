// 첫 화면 배경(6·25 전장의 노을): 하늘 띠·해·산 능선·연기·폭격기·참호·태극기·걷는 병사 실루엣·불씨. 수치는 data/title.json
import * as Phaser from 'phaser';
import title from '../data/title.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { manifest } from '../assets/manifest';
import { parseColor } from '../core/feel';
import { registerUnitAnims } from '../systems/anims';

const W = LOGICAL_WIDTH;
const H = LOGICAL_HEIGHT;
const col = (c: string) => parseColor(c);

/** 결정적 능선 높이(사인 합 + 계단): 같은 seed면 같은 모양 */
function ridgeY(x: number, base: number, amp: number, seed: number): number {
  const s = seed * 1.7;
  const v = 0.55 * Math.sin(x * 0.011 + s) + 0.3 * Math.sin(x * 0.027 + s * 2.3) + 0.15 * Math.sin(x * 0.071 + s * 0.7);
  return Math.round(base - amp * (0.5 + 0.5 * v));
}

/** 앞 능선(병사가 걷는 땅) 높이 */
export const groundY = (x: number): number => ridgeY(x, 470, 26, 41);

export function drawWarBackdrop(scene: Phaser.Scene): void {
  const g = scene.add.graphics();
  // 하늘: 계단식 노을 띠(레트로 디더 대신 굵은 띠)
  const bands = title.sky;
  const bandH = Math.ceil(360 / bands.length);
  bands.forEach((c, i) => g.fillStyle(col(c), 1).fillRect(0, i * bandH, W, bandH + 1));
  // 별 몇 개(위쪽 어두운 하늘)
  for (let i = 0; i < 40; i++) g.fillStyle(0xffe8c0, 0.25 + ((i * 7) % 5) * 0.12).fillRect((i * 97) % W, (i * 53) % 120, 1, 1);
  // 해: 아래쪽에 가로 줄무늬(레트로 노을)
  const sun = title.sun;
  g.fillStyle(col(sun.color), 1).fillCircle(sun.x, sun.y, sun.r);
  for (let k = 0; k < 6; k++) g.fillStyle(col(sun.stripe), 1).fillRect(sun.x - sun.r, sun.y + 6 + k * 9, sun.r * 2, 2 + k);
  // 산 능선 3겹(먼 것부터). 연기는 가장 먼 능선 바로 앞(뒤 능선들에 아래가 가려짐)
  const front = scene.add.graphics();
  title.ridges.forEach((r, i) => {
    if (i === 1) animateSmoke(scene);
    const gg = i === 0 ? g : front;
    gg.fillStyle(col(r.color), 1);
    const pts: Phaser.Types.Math.Vector2Like[] = [{ x: 0, y: H }];
    for (let x = 0; x <= W; x += 6) pts.push({ x, y: ridgeY(x, r.base, r.amp, r.seed) });
    pts.push({ x: W, y: H });
    gg.fillPoints(pts, true);
  });
  // 앞 땅(병사가 걷는 능선)
  const gnd = front;
  gnd.fillStyle(col(title.ground), 1);
  const gp: Phaser.Types.Math.Vector2Like[] = [{ x: 0, y: H }];
  for (let x = 0; x <= W; x += 4) gp.push({ x, y: groundY(x) });
  gp.push({ x: W, y: H });
  gnd.fillPoints(gp, true);
  // 능선 윤곽에 노을빛 테두리
  gnd.lineStyle(1, 0x6a2a24, 1).strokePoints(gp.slice(1, -1), false);
  drawTrench(gnd);
  drawFlag(scene, gnd);
  animatePlane(scene);
  animateMarchers(scene);
  animateEmbers(scene);
}

/** 왼쪽 참호: 모래주머니 두 줄 + 철조망(말뚝과 지그재그 철선) */
function drawTrench(g: Phaser.GameObjects.Graphics): void {
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 7; i++) {
      const x = 18 + i * 22 + row * 11;
      const y = groundY(x) - 10 - row * 9;
      g.fillStyle(row ? 0x3a2a1c : 0x2e2016, 1).fillRoundedRect(x, y, 22, 10, 4);
      g.lineStyle(1, 0x1a120c, 1).strokeRoundedRect(x, y, 22, 10, 4);
    }
  g.lineStyle(1, 0x5a4a40, 1);
  const wx = [200, 236, 272, 308];
  for (const x of wx) g.lineBetween(x, groundY(x), x, groundY(x) - 22);
  for (let i = 0; i < wx.length - 1; i++) {
    const a = wx[i] ?? 0;
    const b = wx[i + 1] ?? 0;
    for (let k = 0; k < 6; k++) {
      const x1 = a + ((b - a) * k) / 6;
      const x2 = a + ((b - a) * (k + 1)) / 6;
      g.lineBetween(x1, groundY(a) - 18 + (k % 2) * 8, x2, groundY(a) - 18 + ((k + 1) % 2) * 8);
    }
  }
}

/** 오른쪽 언덕 꼭대기의 태극기(깃대 + 바람에 살짝 펄럭임). 도트로 직접 그림 */
function drawFlag(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics): void {
  const x = 868;
  const top = groundY(x) - 78;
  g.lineStyle(2, 0x3a2a20, 1).lineBetween(x, groundY(x), x, top - 2);
  g.fillStyle(0xd8c070, 1).fillCircle(x, top - 3, 2);
  const f = scene.add.graphics({ x: x + 1, y: top });
  const fw = 36;
  const fh = 24;
  f.fillStyle(0xf4efe4, 1).fillRect(0, 0, fw, fh);
  // 태극: 위 빨강, 아래 파랑(작은 반원 두 개로 물결)
  const cx = fw / 2;
  const cy = fh / 2;
  const r = 6;
  f.fillStyle(0xc8202c, 1).slice(cx, cy, r, Math.PI, 0, false).fillPath();
  f.fillStyle(0x1c3c8c, 1).slice(cx, cy, r, 0, Math.PI, false).fillPath();
  f.fillStyle(0xc8202c, 1).fillCircle(cx - r / 2, cy, r / 2);
  f.fillStyle(0x1c3c8c, 1).fillCircle(cx + r / 2, cy, r / 2);
  // 네 모서리 괘(검은 막대 3줄)
  f.fillStyle(0x141414, 1);
  for (const [bx, by] of [[4, 3], [fw - 10, 3], [4, fh - 8], [fw - 10, fh - 8]]) for (let k = 0; k < 3; k++) f.fillRect(bx ?? 0, (by ?? 0) + k * 2, 6, 1);
  f.lineStyle(1, 0x8a8070, 1).strokeRect(0, 0, fw, fh);
  scene.tweens.add({ targets: f, scaleX: 0.9, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
}

function animateSmoke(scene: Phaser.Scene): void {
  for (const sx of title.smokeColumns) {
    for (let i = 0; i < 10; i++) {
      const puff = scene.add.circle(sx, 340, 5 + (i % 4) * 2, 0x3a2a30, 0.35);
      const rise = () => {
        puff.setPosition(sx + Phaser.Math.Between(-3, 3), 330).setScale(0.7).setAlpha(0.45);
        scene.tweens.add({ targets: puff, y: 150 + Phaser.Math.Between(-20, 20), x: sx + 70 + Phaser.Math.Between(-15, 15), scale: 3.2, alpha: 0, duration: 11000, onComplete: rise });
      };
      scene.time.delayedCall(i * 1100, rise);
    }
  }
}

function animatePlane(scene: Phaser.Scene): void {
  const key = manifest.fx('bomber').key;
  if (!scene.textures.exists(key)) return;
  const fly = () => {
    const y = Phaser.Math.Between(70, 150);
    // 역광 실루엣
    const p = scene.add.image(-80, y, key, 0).setScale(0.32).setTint(0x2a1828).setAlpha(0.9);
    scene.tweens.add({ targets: p, x: W + 80, y: y - 20, duration: 9000, onComplete: () => p.destroy() });
  };
  scene.time.delayedCall(1200, fly);
  scene.time.addEvent({ delay: title.planeEverySec * 1000, loop: true, callback: fly });
}

/** 앞 능선을 걸어가는 병사 실루엣(걸음 프레임, 역광이라 어둡게) */
function animateMarchers(scene: Phaser.Scene): void {
  const span = W + 140;
  title.marchers.forEach((id, i) => {
    if (!manifest.sheet(id, 'move_slow').path) return;
    const anims = registerUnitAnims(scene, id);
    const key = anims.keys.move_slow;
    if (!key) return;
    const s = scene.add.sprite(0, 0, manifest.sheetKey(id, 'move_slow'), 0).setOrigin(manifest.anchor.x, manifest.anchor.y).setTint(0xb08070).setScale(0.9);
    s.play({ key, startFrame: i % 4 });
    // 처음부터 화면 안 능선에 줄지어(오른쪽 끝을 지나면 왼쪽 밖에서 다시)
    const start = 360 - i * title.marchGap;
    const ev = { d: 0 };
    const place = () => {
      const x = ((start + ev.d + 70) % span) - 70;
      s.setPosition(Math.round(x), groundY(Math.max(0, Math.min(W, x))) + 2);
    };
    place();
    scene.tweens.add({ targets: ev, d: span, duration: (span / title.marchSpeed) * 1000, repeat: -1, onUpdate: place });
  });
}

function animateEmbers(scene: Phaser.Scene): void {
  for (let i = 0; i < title.embers; i++) {
    const e = scene.add.rectangle(0, 0, 2, 2, i % 3 ? 0xffa040 : 0xffe080, 1);
    const go = () => {
      e.setPosition(Phaser.Math.Between(0, W), H + 4).setAlpha(Phaser.Math.FloatBetween(0.4, 1));
      scene.tweens.add({ targets: e, y: Phaser.Math.Between(140, 380), x: e.x + Phaser.Math.Between(-40, 60), alpha: 0, duration: Phaser.Math.Between(4000, 8000), onComplete: go });
    };
    scene.time.delayedCall(i * 220, go);
  }
}
