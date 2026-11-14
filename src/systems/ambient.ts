// 주변 생활(소·호랑이·진돗개·마을 주민, 2026-11-14): 전장 가장자리를 천천히 거닐다 폭발이 가까우면 서둘러 화면 밖으로 떠나 사라진다.
// 다치거나 쓰러지는 묘사 없음(PRD §1), 공격 대상·충돌 없음. 그림(critters/W01_walk.png 등)이 없으면 단순 도트를 그려 쓴다.
import type * as Phaser from 'phaser';
import ambientData from '../data/ambient.json';
import { Depth } from '../config/depth';
import { manifest } from '../assets/manifest';
import { registerUnitAnims } from './anims';
import { fleeDir, nextWander, outside, spawnPoint, type AmbientCfg, type View } from '../core/ambient';
import { createRng, type Rng } from '../core/rng';

interface CritterDef {
  name: string;
  walk: number;
  run: number;
  w: number;
  h: number;
  shape: string;
  body: string;
  dark: string;
  light: string;
}
type Mode = 'walk' | 'idle' | 'flee';
const CFG = ambientData as unknown as AmbientCfg & {
  critters: Record<string, CritterDef>;
  stages: Record<string, string[]>;
  maxAlive: number;
  firstMs: number;
  everyMs: number[];
  fadeMs: number;
};

interface Critter {
  id: string;
  def: CritterDef;
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  mode: Mode;
  until: number;
  dirX: number;
  dirY: number;
  keys: Record<'walk' | 'idle' | 'run', string>;
  gone: boolean;
}

const OUT = '#2a1a10';
const SKIN = '#d8a878';
const HAIR = '#2a1a10';
const WOOD = '#6a4a2a';

export class AmbientSystem {
  private list: Critter[] = [];
  private nextAt = CFG.firstMs;
  private readonly ids: string[];
  private readonly rng: Rng;

  constructor(
    private readonly scene: Phaser.Scene,
    stage: string,
    seed: string,
  ) {
    this.rng = createRng(`ambient:${seed}`);
    this.ids = (CFG.stages[stage] ?? []).filter((id) => CFG.critters[id]);
  }

  get count(): number {
    return this.list.length;
  }

  /** 지금 있는 것(테스트·디버그용) */
  get active(): readonly { id: string; x: number; y: number; mode: Mode }[] {
    return this.list;
  }

  /** 디버그·테스트: 지금 바로 하나 */
  spawnNow(cam: Phaser.Cameras.Scene2D.Camera, nowMs: number, id?: string): void {
    this.spawn(viewOf(cam), nowMs, id);
  }

  update(nowMs: number, dtMs: number, player: { x: number; y: number }, cam: Phaser.Cameras.Scene2D.Camera): void {
    const v = viewOf(cam);
    if (this.ids.length > 0 && nowMs >= this.nextAt) {
      if (this.list.length < CFG.maxAlive) this.spawn(v, nowMs);
      const [lo = 10000, hi = lo] = CFG.everyMs;
      this.nextAt = nowMs + lo + (hi - lo) * this.rng.next();
    }
    const dt = dtMs / 1000;
    for (const c of this.list) {
      if (c.gone) continue;
      if (c.mode !== 'flee' && nowMs >= c.until) {
        const w = nextWander(this.rng, CFG, c, player);
        c.mode = w.mode;
        c.until = nowMs + w.ms;
        if (w.mode === 'walk') {
          c.dirX = w.dirX;
          c.dirY = w.dirY;
        }
      }
      const speed = c.mode === 'flee' ? c.def.run : c.mode === 'walk' ? c.def.walk : 0;
      c.x += c.dirX * speed * dt;
      c.y += c.dirY * speed * dt;
      // 떠나는 중 화면 밖으로 나가면, 또는 거닐다 너무 멀어지면(플레이어가 멀리 감) 사라짐
      if ((c.mode === 'flee' && outside(c.x, c.y, v, 24)) || outside(c.x, c.y, v, CFG.despawnBeyond)) {
        c.gone = true;
        this.scene.tweens.add({ targets: c.sprite, alpha: 0, duration: CFG.fadeMs, onComplete: () => c.sprite.destroy() });
        continue;
      }
      const key = c.keys[c.mode === 'flee' ? 'run' : c.mode];
      if (c.sprite.anims.currentAnim?.key !== key) c.sprite.play(key);
      if (Math.abs(c.dirX) > 0.05 && c.mode !== 'idle') c.sprite.setFlipX(c.dirX < 0);
      c.sprite.setPosition(Math.round(c.x), Math.round(c.y)).setDepth(Depth.Unit + (c.y - cam.scrollY) * 0.001);
    }
    this.list = this.list.filter((c) => !c.gone);
  }

  /** 폭발(아군 폭탄·포격, 적 포탄): 가까운 것은 반대쪽으로 서둘러 떠남 */
  blast(x: number, y: number, r: number): void {
    for (const c of this.list) {
      if (c.gone || c.mode === 'flee') continue;
      const d = fleeDir(c, { x, y, r }, CFG);
      if (!d) continue;
      c.mode = 'flee';
      c.dirX = d.dirX;
      c.dirY = d.dirY * 0.7;
      // 깜짝 놀라 살짝 뛰어오름
      this.scene.tweens.add({ targets: c.sprite, scaleY: c.sprite.scaleY * 1.12, duration: 90, yoyo: true });
    }
  }

  destroy(): void {
    for (const c of this.list) c.sprite.destroy();
    this.list = [];
  }

  private spawn(v: View, nowMs: number, only?: string): void {
    const id = only ?? this.ids[Math.floor(this.rng.next() * this.ids.length)];
    const def = id ? CFG.critters[id] : undefined;
    if (!id || !def) return;
    const p = spawnPoint(this.rng, v, CFG.spawnMargin);
    const keys = critterAnims(this.scene, id, def);
    // 코드 도트는 1.5배(2배 화면에서 도트 하나 = 3px로 고르게), 그림 시트는 원래 크기
    const sprite = this.scene.add.sprite(p.x, p.y, '__DEFAULT').setOrigin(0.5, keys.art ? 0.92 : 1).setScale(keys.art ? 1 : 1.5);
    sprite.play(keys.walk).setFlipX(p.dirX < 0);
    this.list.push({ id, def, sprite, x: p.x, y: p.y, mode: 'walk', until: nowMs + 2500 + 2000 * this.rng.next(), dirX: p.dirX, dirY: p.dirY * 0.6, keys, gone: false });
  }
}

function viewOf(cam: Phaser.Cameras.Scene2D.Camera): View {
  const w = cam.worldView;
  return { x: w.x, y: w.y, w: w.width, h: w.height };
}

/** 그림이 있으면 그 애니메이션, 없으면 단순 도트(걷기·쉬기·뛰기 4프레임씩) */
function critterAnims(scene: Phaser.Scene, id: string, def: CritterDef): Record<'walk' | 'idle' | 'run', string> & { art: boolean } {
  const sheets = manifest.unitSheets(id);
  if (sheets.every((s) => s.path !== null && scene.textures.exists(s.key))) {
    const a = registerUnitAnims(scene, id);
    return { walk: a.keys.walk ?? '', idle: a.keys.idle ?? '', run: a.keys.run ?? '', art: true };
  }
  const tex = `critter_dots_${id}`;
  const fw = def.w + 8;
  const fh = def.h + 8;
  const actions = ['walk', 'idle', 'run'] as const;
  if (!scene.textures.exists(tex)) {
    const canvas = scene.textures.createCanvas(tex, fw * 12, fh);
    const ctx = canvas?.getContext();
    if (canvas && ctx) {
      actions.forEach((action, ai) => {
        for (let f = 0; f < 4; f++) {
          const i = ai * 4 + f;
          ctx.save();
          ctx.translate(i * fw, 0);
          drawCritter(ctx, def, action, f, fw, fh);
          ctx.restore();
          canvas.add(i, 0, i * fw, 0, fw, fh);
        }
      });
      canvas.refresh();
    }
  }
  const out = { walk: '', idle: '', run: '', art: false };
  actions.forEach((action, ai) => {
    const key = `${tex}_${action}`;
    if (!scene.anims.exists(key)) {
      const fps = action === 'run' ? 12 : action === 'walk' ? 6 : 3;
      scene.anims.create({ key, frames: [0, 1, 2, 3].map((f) => ({ key: tex, frame: ai * 4 + f })), frameRate: fps, repeat: -1 });
    }
    out[action] = key;
  });
  return out;
}

/** 옆모습(오른쪽 보기), 발이 칸 바닥. 다리는 걷기·뛰기에서 앞뒤로 엇갈림(네발은 대각선 짝) */
function drawCritter(ctx: CanvasRenderingContext2D, d: CritterDef, action: 'walk' | 'idle' | 'run', f: number, fw: number, fh: number): void {
  const base = fh - 2;
  const ox = Math.round((fw - d.w) / 2);
  const amp = action === 'run' ? 4 : action === 'walk' ? 2 : 0;
  const swing = f === 0 ? amp : f === 2 ? -amp : 0;
  const bob = action !== 'idle' && f % 2 === 1 ? -1 : 0;
  const r = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + x, y + bob, w, h);
  };
  // 다리: 엉덩이(위)는 고정, 발이 off만큼 앞뒤로
  const leg = (x: number, top: number, len: number, w: number, off: number, c: string, foot: string) => {
    for (let k = 0; k < 3; k++) {
      const seg = Math.ceil(len / 3);
      ctx.fillStyle = c;
      ctx.fillRect(ox + x + Math.round((off * k) / 2), top + k * seg + (k === 0 ? bob : 0), w, k === 2 ? len - 2 * seg : seg);
    }
    ctx.fillStyle = foot;
    ctx.fillRect(ox + x + off, base - 1, w + 1, 1);
  };
  const quad = d.shape === 'cow' || d.shape === 'tiger' || d.shape === 'dog';
  if (quad) {
    const L = d.shape === 'dog' ? { len: 7, w: 2, front: d.w - 12, hind: 6, top: base - 7 } : { len: d.shape === 'cow' ? 12 : 11, w: 3, front: d.w - 16, hind: 8, top: base - (d.shape === 'cow' ? 12 : 11) };
    // 먼 쪽 다리(어둡게) 먼저: 대각선 짝 = 가까운 앞다리 + 먼 뒷다리
    leg(L.front - 3, L.top, L.len, L.w, -swing, d.dark, OUT);
    leg(L.hind + 3, L.top, L.len, L.w, swing, d.dark, OUT);
    const bodyTop = L.top - (d.shape === 'dog' ? 7 : d.shape === 'cow' ? 14 : 11);
    const bodyH = d.shape === 'dog' ? 8 : d.shape === 'cow' ? 15 : 12;
    const bodyX = d.shape === 'dog' ? 4 : 6;
    const bodyW = d.w - (d.shape === 'dog' ? 12 : 18);
    r(bodyX - 1, bodyTop - 1, bodyW + 2, bodyH + 2, OUT);
    r(bodyX, bodyTop, bodyW, bodyH, d.body);
    r(bodyX + 2, bodyTop + bodyH - 2, bodyW - 4, 2, d.shape === 'tiger' || d.shape === 'dog' ? d.light : d.dark);
    if (d.shape === 'tiger') for (let x = bodyX + 3; x < bodyX + bodyW - 2; x += 5) r(x, bodyTop, 2, bodyH - 4, d.dark);
    if (d.shape === 'cow') r(bodyX + 3, bodyTop + 1, bodyW - 6, 2, d.light);
    // 머리(쉬기에서 소는 풀을 뜯느라 숙임)
    const graze = action === 'idle' && d.shape === 'cow' && f >= 1 && f <= 2 ? 6 : 0;
    const hw = d.shape === 'dog' ? 7 : 10;
    const hx = bodyX + bodyW - 2;
    const hy = bodyTop - (d.shape === 'dog' ? 4 : 3) + graze;
    r(hx - 1, hy - 1, hw + 2, hw, OUT);
    r(hx, hy, hw, hw - 2, d.body);
    r(hx + hw - 3, hy + hw - 6, 4, 3, d.light);
    r(hx + hw - 4, hy + 2, 1, 1, OUT);
    if (d.shape === 'cow') r(hx + 1, hy - 3, 2, 3, '#e8dcc0');
    if (d.shape === 'tiger') r(hx + 3, hy + 1, 1, 3, d.dark);
    if (d.shape === 'dog') r(hx + 1, hy - 3, 2, 3, d.body);
    // 꼬리
    const wag = action === 'idle' ? (f % 2 === 0 ? -1 : 1) : 0;
    if (d.shape === 'dog') r(bodyX - 2, bodyTop - 3 + wag, 3, 4, d.body);
    else if (d.shape === 'tiger') {
      r(bodyX - 6, bodyTop + 1, 7, 2, d.body);
      r(bodyX - 7, bodyTop - 2 + wag, 2, 3, d.dark);
    } else {
      r(bodyX - 2, bodyTop + 1, 2, 9 + wag, d.dark);
      r(bodyX - 3, bodyTop + 9 + wag, 3, 2, OUT);
    }
    // 가까운 쪽 다리(밝게)
    leg(L.front, L.top, L.len, L.w, swing, d.body, OUT);
    leg(L.hind, L.top, L.len, L.w, -swing, d.body, OUT);
    return;
  }
  // 사람: 먼 다리 → 몸 → 가까운 다리
  const cx = Math.round(d.w / 2) - 2;
  const lean = action === 'run' ? 2 : 0;
  const hipY = base - 16;
  const woman = d.shape === 'woman';
  if (!woman) leg(cx - 1, hipY, 16, 3, -swing, d.dark, '#5a3a1a');
  if (woman) {
    // 긴 치마(흔들림) + 엇갈리는 발
    r(cx - 4 + lean, hipY - 6, 10, 8, d.dark);
    r(cx - 5 + lean + (f % 2), hipY + 2, 12, 12, d.dark);
    r(cx - 3 - swing / 2, base - 2, 3, 2, '#ffffff');
    r(cx + 3 + swing / 2, base - 2, 3, 2, '#ffffff');
  }
  // 웃옷
  const top = hipY - (woman ? 15 : 14);
  r(cx - 4 + lean, top, 10, woman ? 9 : 15, d.body);
  r(cx + 4 + lean, top, 2, woman ? 9 : 15, '#c8c0b0');
  if (!woman) r(cx - 4 + lean, hipY - 1, 10, 1, '#5a4a3a');
  if (woman) r(cx + 2 + lean, top + 3, 2, 5, '#c84a4a');
  // 머리
  const hy = top - 9;
  r(cx - 3 + lean, hy, 8, 9, SKIN);
  r(cx + 3 + lean, hy + 3, 1, 1, OUT);
  if (woman) {
    r(cx - 3 + lean, hy - 1, 8, 3, '#ffffff');
    r(cx - 5 + lean, hy + 2, 3, 3, HAIR);
    // 머리에 인 보따리(한 손으로 받침)
    r(cx - 6 + lean, hy - 7, 14, 6, '#a87a4a');
    r(cx - 1 + lean, hy - 9, 3, 2, '#a87a4a');
    r(cx + 5 + lean, hy - 2, 2, 10, d.body);
  } else {
    r(cx - 3 + lean, hy - 1, 8, 3, HAIR);
    r(cx - 3 + lean, hy + 1, 8, 1, '#ffffff');
    // 지게(나무 틀 + 장작)
    r(cx - 8 + lean, top - 4, 2, 22, WOOD);
    r(cx - 11 + lean, top - 10, 8, 8, '#8a6a3a');
    r(cx - 11 + lean, top - 7, 8, 1, WOOD);
    // 팔(걷기 땐 다리 반대로, 쉬기 2프레임째는 이마의 땀을 훔침)
    const wipe = action === 'idle' && f === 2;
    r(cx + 3 + lean - (wipe ? 0 : swing / 2), wipe ? hy + 2 : top + 3, 3, wipe ? 8 : 9, wipe ? d.body : SKIN);
  }
  if (!woman) leg(cx + 1, hipY, 16, 3, swing, d.body, '#5a3a1a');
}
