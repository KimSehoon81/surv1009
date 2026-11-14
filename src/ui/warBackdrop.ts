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
    const far = title.ridges[0];
    if (i === 1 && far) {
      const farY = (x: number) => ridgeY(x, far.base, far.amp, far.seed);
      animatePlumes(scene, title.plumes.map((pl) => ({ x: pl.x, y: farY(pl.x) + 8, size: pl.size })));
      animateArtillery(scene, farY);
      animateFlares(scene);
      animateTracers(scene, farY);
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


/** 산 뒤에서 피어오르는 굵은 연기 기둥: 밑동은 불빛(깜박), 위로 갈수록 커지고 바람 따라 오른쪽으로 흩어짐 */
function animatePlumes(scene: Phaser.Scene, list: readonly { x: number; y: number; size: number }[]): void {
  for (const pl of list) {
    const by = pl.y;
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
function animateArtillery(scene: Phaser.Scene, ridge: (x: number) => number, skip?: readonly number[], puffs = true): void {
  const [lo = 500, hi = 1500] = title.artilleryMs;
  const fire = () => {
    let x = Phaser.Math.Between(30, W - 30);
    if (skip && x >= (skip[0] ?? 0) && x <= (skip[1] ?? 0)) x = Phaser.Math.Between(30, skip[0] ?? 30);
    const y = ridge(x) - 2;
    const flash = scene.add.circle(x, y, Phaser.Math.Between(5, 11), 0xfff0b0, 1).setBlendMode(Phaser.BlendModes.ADD);
    const halo = scene.add.circle(x, y, 26, 0xffa040, 0.35).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: [flash, halo], alpha: 0, scale: 1.6, duration: 220, onComplete: () => (flash.destroy(), halo.destroy()) });
    if (puffs) {
      const puff = scene.add.circle(x, y - 4, 5, 0x3a2c30, 0.6);
      scene.tweens.add({ targets: puff, y: y - 40, scale: 3, alpha: 0, duration: 2600, onComplete: () => puff.destroy() });
    }
    scene.time.delayedCall(Phaser.Math.Between(lo, hi), fire);
  };
  scene.time.delayedCall(400, fire);
}

/** 조명탄: 하늘에서 흔들리며 천천히 내려오는 밝은 점(빛무리) */
function animateFlares(scene: Phaser.Scene, ranges?: readonly (readonly number[])[]): void {
  const drop = () => {
    const r = ranges?.[Math.floor(Math.random() * ranges.length)];
    const x0 = r ? Phaser.Math.Between(r[0] ?? 80, r[1] ?? W - 80) : Phaser.Math.Between(80, W - 80);
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
function animateTracers(scene: Phaser.Scene, ridge: (x: number) => number): void {
  const [lo = 1100, hi = 2400] = title.tracerMs;
  const burst = () => {
    const fromLeft = Math.random() < 0.5;
    const x1 = fromLeft ? Phaser.Math.Between(20, 300) : Phaser.Math.Between(W - 300, W - 20);
    const x2 = x1 + (fromLeft ? 1 : -1) * Phaser.Math.Between(220, 420);
    const y1 = ridge(x1);
    const y2 = ridge(x2);
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

// ---------------------------------------------------------------- 그림 배경(2026-11-14, 사용자 제공 노을 전장)

type Bg = typeof title.bg;

/** 첫 화면: 배경 그림(sprites/title_bg.png)이 있으면 그 위에 연출하고 true, 없으면 false(코드 배경을 쓰라는 뜻) */
export function drawTitleScene(scene: Phaser.Scene): boolean {
  const bg = title.bg;
  const key = manifest.sprite(bg.sprite).key;
  if (!scene.textures.exists(key)) return false;
  scene.add.image(0, 0, key).setOrigin(0).setDisplaySize(W, H);
  const pts = bg.ridge as unknown as [number, number][];
  // 능선 y: 표의 점 사이를 직선으로
  const ridge = (x: number): number => {
    for (let i = 1; i < pts.length; i++) {
      const [x1 = 0, y1 = 0] = pts[i - 1] ?? [];
      const [x2 = 0, y2 = 0] = pts[i] ?? [];
      if (x <= x2) return Math.round(y1 + ((y2 - y1) * (x - x1)) / Math.max(1, x2 - x1));
    }
    return pts[pts.length - 1]?.[1] ?? H / 2;
  };
  animateSmoke(scene, bg.plumes, bg.smoke);
  animateArtillery(scene, ridge, bg.artillerySkipX, false);
  animateTracers(scene, ridge);
  animateFlares(scene, bg.flareX);
  animateColumn(scene, bg.column);
  animateFieldBlasts(scene, bg.blasts);
  animateSquad(scene, bg.squad);
  animateEmbers(scene);
  return true;
}

/** 폐허에서 끊김 없이 오르는 연기 기둥: 퍼프마다 시작 시점을 나눠 처음부터 기둥 모양, 위로 갈수록 커지고 바람에 오른쪽으로 */
function animateSmoke(scene: Phaser.Scene, list: Bg['plumes'], sm: Bg['smoke']): void {
  const puffs: { o: Phaser.GameObjects.Arc; x: number; y: number; size: number; phase: number; wob: number }[] = [];
  for (const pl of list) {
    // 밑동: 은은한 불빛(작게, 깜박임)
    const glow = scene.add.ellipse(pl.x, pl.y, 18 * pl.size, 8 * pl.size, 0xff7a30, 0.45).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: glow, alpha: 0.15, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.inOut', delay: Phaser.Math.Between(0, 300) });
    const n = Math.round(sm.puffs * pl.size);
    for (let i = 0; i < n; i++) {
      const color = i % 3 === 0 ? 0x5a4048 : i % 3 === 1 ? 0x3a2a32 : 0x2a2028;
      puffs.push({ o: scene.add.circle(pl.x, pl.y, 6 * pl.size, color, 0.7), x: pl.x, y: pl.y, size: pl.size, phase: i / n, wob: Math.random() * 6 });
    }
  }
  const tick = () => {
    const now = scene.time.now;
    for (const p of puffs) {
      const k = (now / sm.lifeMs + p.phase) % 1;
      const x = p.x + sm.drift * p.size * k * k + Math.sin(now / 900 + p.wob) * 3 * k;
      const y = p.y - sm.rise * p.size * Math.pow(k, 0.8);
      p.o.setPosition(Math.round(x), Math.round(y)).setScale(0.6 + 2.8 * k).setAlpha(0.75 * (1 - k) * Math.min(1, k * 8));
    }
  };
  tick();
  scene.events.on(Phaser.Scenes.Events.UPDATE, tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, tick));
}

/** 먼 들판을 줄지어 걷는 실루엣 대열(작게, 역광이라 검붉게) */
function animateColumn(scene: Phaser.Scene, c: Bg['column']): void {
  const span = W + 120;
  for (let i = 0; i < c.count; i++) {
    const id = c.ids[i % c.ids.length] ?? 'A01';
    if (!manifest.sheet(id, 'move_slow').path) continue;
    const key = registerUnitAnims(scene, id).keys.move_slow;
    if (!key) continue;
    const s = scene.add.sprite(0, 0, manifest.sheetKey(id, 'move_slow'), 0).setOrigin(manifest.anchor.x, manifest.anchor.y).setScale(c.scale).setTintFill(col(c.color)).setAlpha(0.92);
    s.play({ key, startFrame: (i * 3) % 6 });
    s.anims.timeScale = 0.75;
    const start = 120 + i * c.gap;
    const ev = { d: 0 };
    const place = () => s.setPosition(Math.round(((start + ev.d) % span) - 60), c.y + (i % 2));
    place();
    scene.tweens.add({ targets: ev, d: span, duration: (span / c.speed) * 1000, repeat: -1, onUpdate: place });
  }
}

/** 앞 땅을 걷는 분대: 실제 스프라이트(노을 역광으로 살짝 어둡게), 발밑 그림자·흙먼지, 맨 앞 병사는 작은 태극기 */
function animateSquad(scene: Phaser.Scene, sq: Bg['squad']): void {
  const span = W + 160;
  sq.ids.forEach((id, i) => {
    if (!manifest.sheet(id, 'move_slow').path) return;
    const key = registerUnitAnims(scene, id).keys.move_slow;
    if (!key) return;
    const shadow = scene.add.ellipse(0, 0, 30, 7, 0x0a0406, 0.45);
    const s = scene.add.sprite(0, 0, manifest.sheetKey(id, 'move_slow'), 0).setOrigin(manifest.anchor.x, manifest.anchor.y).setTint(col(sq.tint));
    s.play({ key, startFrame: (i * 2) % 6 });
    const lead = sq.flagBearer && i === 0;
    const flag = lead ? scene.add.graphics() : null;
    // 맨 앞(i = 0)이 가장 오른쪽, 처음부터 화면 안에 줄지어
    const start = 640 - i * sq.gap;
    const ev = { d: 0 };
    let dustAt = 0;
    const place = () => {
      const x = Math.round(((start + ev.d + 80) % span) - 80);
      s.setPosition(x, sq.y);
      shadow.setPosition(x, sq.y - 1);
      if (flag) drawMiniFlag(flag, x + 12, sq.y - 84, scene.time.now);
      const now = scene.time.now;
      if (now > dustAt) {
        dustAt = now + 380 + i * 23;
        const puff = scene.add.circle(x - 8, sq.y - 2, 3, 0x6a4a3a, 0.5);
        scene.tweens.add({ targets: puff, x: puff.x - 10, y: puff.y - 6, scale: 2.2, alpha: 0, duration: 700, onComplete: () => puff.destroy() });
      }
    };
    place();
    scene.tweens.add({ targets: ev, d: span, duration: (span / sq.speed) * 1000, repeat: -1, onUpdate: place });
  });
}

/** 손에 든 깃대 + 펄럭이는 태극기(흰 바탕·빨강/파랑 태극·네 귀 괘), 두 프레임으로 물결 */
function drawMiniFlag(g: Phaser.GameObjects.Graphics, x: number, y: number, now: number): void {
  const w = Math.floor(now / 180) % 2;
  g.clear();
  // 깃대(위 꼭지 금색)
  g.fillStyle(0x1a0a06, 1).fillRect(x - 1, y - 1, 4, 52);
  g.fillStyle(0xb08a50, 1).fillRect(x, y, 2, 50);
  g.fillStyle(0xffd34d, 1).fillRect(x - 1, y - 3, 4, 3);
  // 깃발: 외곽선 → 흰 바탕(물결: 오른쪽 절반이 한 칸 오르내림)
  g.fillStyle(0x1a0a06, 1).fillRect(x + 2, y + 1, 21, 15);
  g.fillStyle(0xf4f0e6, 1).fillRect(x + 3, y + 2, 9, 13).fillRect(x + 12, y + 2 + w, 10, 12);
  // 태극(위 빨강, 아래 파랑)
  g.fillStyle(0xd83a3a, 1).fillRect(x + 10, y + 5, 5, 3);
  g.fillStyle(0x2a4ab8, 1).fillRect(x + 10, y + 8, 5, 3);
  // 괘(네 귀의 검은 줄)
  g.fillStyle(0x1a1a1a, 1).fillRect(x + 5, y + 4, 3, 1).fillRect(x + 5, y + 12, 3, 1).fillRect(x + 18, y + 4 + w, 3, 1).fillRect(x + 18, y + 12 + w, 3, 1);
}

/** 먼 들판에 가끔 떨어지는 포탄: 번쩍 → 흙기둥·연기 → 파편 */
function animateFieldBlasts(scene: Phaser.Scene, b: Bg['blasts']): void {
  const [lo = 4000, hi = 8000] = b.ms;
  const boom = () => {
    let x = Phaser.Math.Between(b.x[0] ?? 40, b.x[1] ?? W - 40);
    if (x >= (b.skipX[0] ?? 0) && x <= (b.skipX[1] ?? 0)) x = Math.random() < 0.5 ? Phaser.Math.Between(b.x[0] ?? 40, b.skipX[0] ?? 300) : Phaser.Math.Between(b.skipX[1] ?? 660, b.x[1] ?? W - 40);
    const y = Phaser.Math.Between(b.y[0] ?? 370, b.y[1] ?? 390);
    const flash = scene.add.circle(x, y - 4, 7, 0xfff0b0, 1).setBlendMode(Phaser.BlendModes.ADD);
    const halo = scene.add.circle(x, y - 4, 22, 0xff8a30, 0.45).setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({ targets: [flash, halo], alpha: 0, scale: 1.8, duration: 260, onComplete: () => (flash.destroy(), halo.destroy()) });
    for (let i = 0; i < 6; i++) {
      const puff = scene.add.circle(x + Phaser.Math.Between(-4, 4), y - 2, 4, i % 2 ? 0x2c2026 : 0x4a3030, 0.75);
      scene.tweens.add({ targets: puff, y: y - Phaser.Math.Between(26, 52), x: puff.x + Phaser.Math.Between(4, 18), scale: 2.6, alpha: 0, duration: 2200 + i * 180, ease: 'Quad.out', onComplete: () => puff.destroy() });
    }
    for (let i = 0; i < 5; i++) {
      const bit = scene.add.rectangle(x, y - 4, 2, 2, 0x1a0a08, 1);
      const vx = Phaser.Math.Between(-30, 30);
      scene.tweens.add({ targets: bit, x: x + vx, y: y - Phaser.Math.Between(14, 26), duration: 260, yoyo: true, ease: 'Quad.out', onComplete: () => bit.destroy() });
    }
    scene.time.delayedCall(Phaser.Math.Between(lo, hi), boom);
  };
  scene.time.delayedCall(2200, boom);
}
