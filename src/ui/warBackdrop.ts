// 첫 화면 배경(6·25 전장의 노을): 하늘 띠·해·산 능선·연기 기둥·포격 섬광·조명탄·예광탄·참호·태극기·걷는 병사·불씨. 수치는 data/title.json
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
    // 가장 먼 능선 뒤에서: 연기 기둥(밑동은 앞 능선에 가려짐)·포격 섬광·조명탄·예광탄
    if (i === 1) {
      animatePlumes(scene, title.ridges[0]);
      animateArtillery(scene, title.ridges[0]);
      animateFlares(scene);
      animateTracers(scene, title.ridges[0]);
    }
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

type Ridge = { base: number; amp: number; seed: number };

/** 산 뒤에서 피어오르는 굵은 연기 기둥: 밑동은 불빛(깜박), 위로 갈수록 커지고 바람 따라 오른쪽으로 흩어짐 */
function animatePlumes(scene: Phaser.Scene, far: Ridge | undefined): void {
  if (!far) return;
  for (const pl of title.plumes) {
    const by = ridgeY(pl.x, far.base, far.amp, far.seed) + 8;
    const glow = scene.add.ellipse(pl.x, by, 46 * pl.size, 20 * pl.size, 0xff7a30, 0.55).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: glow, alpha: 0.25, scaleX: 0.85, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: Phaser.Math.Between(0, 300) });
    // 퍼프를 촘촘히(약 0.25초마다) 겹쳐 올려 끊기지 않는 기둥으로
    const life = 9500;
    const n = Math.round(38 * pl.size);
    for (let i = 0; i < n; i++) {
      const puff = scene.add.circle(pl.x, by, 9 * pl.size, i % 4 === 0 ? 0x553a3a : i % 2 ? 0x2c2228 : 0x3a2c30, 0.6);
      const rise = () => {
        puff.setPosition(pl.x + Phaser.Math.Between(-6, 6), by + 4).setScale(0.7).setAlpha(0.7);
        scene.tweens.add({
          targets: puff,
          y: by - Phaser.Math.Between(210, 250) * pl.size,
          x: pl.x + Phaser.Math.Between(70, 110) * pl.size,
          scale: 3.6 + Math.random() * 0.8,
          alpha: 0,
          duration: life + Phaser.Math.Between(-600, 600),
          ease: 'Quad.in',
          onComplete: rise,
        });
      };
      scene.time.delayedCall((i * life) / n, rise);
    }
  }
}

/** 먼 능선의 포격 섬광(번쩍 → 작은 연기) */
function animateArtillery(scene: Phaser.Scene, far: Ridge | undefined): void {
  if (!far) return;
  const [lo = 500, hi = 1500] = title.artilleryMs;
  const fire = () => {
    const x = Phaser.Math.Between(30, W - 30);
    const y = ridgeY(x, far.base, far.amp, far.seed) - 2;
    const flash = scene.add.circle(x, y, Phaser.Math.Between(5, 11), 0xfff0b0, 1).setBlendMode(Phaser.BlendModes.ADD);
    const halo = scene.add.circle(x, y, 26, 0xffa040, 0.35).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: [flash, halo], alpha: 0, scale: 1.6, duration: 220, onComplete: () => (flash.destroy(), halo.destroy()) });
    const puff = scene.add.circle(x, y - 4, 5, 0x3a2c30, 0.6);
    scene.tweens.add({ targets: puff, y: y - 40, scale: 3, alpha: 0, duration: 2600, onComplete: () => puff.destroy() });
    scene.time.delayedCall(Phaser.Math.Between(lo, hi), fire);
  };
  scene.time.delayedCall(400, fire);
}

/** 조명탄: 하늘에서 흔들리며 천천히 내려오는 밝은 점(빛무리) */
function animateFlares(scene: Phaser.Scene): void {
  const drop = () => {
    const x0 = Phaser.Math.Between(80, W - 80);
    const y0 = Phaser.Math.Between(40, 100);
    const halo = scene.add.circle(x0, y0, 22, 0xfff0b0, 0.22).setBlendMode(Phaser.BlendModes.ADD);
    const core = scene.add.circle(x0, y0, 2.5, 0xffffff, 1);
    const st = { k: 0 };
    scene.tweens.add({
      targets: st,
      k: 1,
      duration: 7500,
      onUpdate: () => {
        const x = x0 + Math.sin(st.k * 9) * 6;
        const y = y0 + st.k * 170;
        const a = st.k < 0.8 ? 1 : (1 - st.k) / 0.2;
        core.setPosition(x, y).setAlpha(a);
        halo.setPosition(x, y).setAlpha(0.22 * a * (0.8 + 0.2 * Math.sin(st.k * 60)));
      },
      onComplete: () => (core.destroy(), halo.destroy()),
    });
  };
  scene.time.delayedCall(900, drop);
  scene.time.addEvent({ delay: title.flareEverySec * 1000, loop: true, callback: drop });
}

/** 예광탄: 능선에서 능선으로 포물선을 그리며 날아가는 붉은·초록 점선 몇 발 */
function animateTracers(scene: Phaser.Scene, far: Ridge | undefined): void {
  if (!far) return;
  const [lo = 1100, hi = 2400] = title.tracerMs;
  const burst = () => {
    const fromLeft = Math.random() < 0.5;
    const x1 = fromLeft ? Phaser.Math.Between(20, 300) : Phaser.Math.Between(W - 300, W - 20);
    const x2 = x1 + (fromLeft ? 1 : -1) * Phaser.Math.Between(220, 420);
    const y1 = ridgeY(x1, far.base, far.amp, far.seed);
    const y2 = ridgeY(x2, far.base, far.amp, far.seed);
    const h = Phaser.Math.Between(60, 130);
    const color = Math.random() < 0.6 ? 0xff6a40 : 0x9aff70;
    const shots = Phaser.Math.Between(3, 5);
    for (let i = 0; i < shots; i++) {
      const dot = scene.add.rectangle(x1, y1, 4, 2, color, 1).setBlendMode(Phaser.BlendModes.ADD);
      const st = { k: 0 };
      scene.tweens.add({
        targets: st,
        k: 1,
        delay: i * 110,
        duration: 900,
        onUpdate: () => {
          const x = x1 + (x2 - x1) * st.k;
          const y = y1 + (y2 - y1) * st.k - Math.sin(st.k * Math.PI) * h;
          dot.setPosition(x, y).setRotation(Math.atan2(y2 - y1 - Math.cos(st.k * Math.PI) * Math.PI * h, x2 - x1));
        },
        onComplete: () => dot.destroy(),
      });
    }
    scene.time.delayedCall(Phaser.Math.Between(lo, hi), burst);
  };
  scene.time.delayedCall(1500, burst);
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
