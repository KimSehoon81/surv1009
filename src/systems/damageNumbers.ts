import type * as Phaser from 'phaser';
import { CappedPool } from '../core/pool';
import { numberAnim, parseColor, type NumberAnimConfig } from '../core/feel';
import type { Rng } from '../core/rng';
import { Depth } from '../config/depth';
import { PIXEL_FONT, ensurePixelFont } from '../ui/pixelFont';

export interface NumberStyleData {
  color: string;
  scale: number;
  text?: string;
  lifeMs?: number;
  jitterPx?: number;
  jitterMs?: number;
}

export interface NumbersData extends NumberAnimConfig {
  cap: number;
  scale: number;
  lifeMs: number;
  spreadPx: number;
  /** 같은 대상·같은 스타일 숫자를 이 시간 안이면 하나로 합산(연사 숫자 폭주 방지) */
  mergeMs?: number;
  styles: Record<string, NumberStyleData>;
}

interface Num {
  text: Phaser.GameObjects.BitmapText;
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
  scale: number;
  jitterPx: number;
  jitterMs: number;
  /** 합산용: 맞은 대상, 스타일, 지금까지 합 */
  key: object | null;
  style: string;
  sum: number;
}

/** 데미지 숫자(PRD §4.4: 동시 40개 상한, 넘치면 가장 오래된 것 재사용). 시간은 전투 시계 */
export class DamageNumbers {
  private readonly pool: CappedPool<Num>;
  private readonly styles = new Map<string, NumberStyleData & { tint: number }>();

  constructor(
    scene: Phaser.Scene,
    private readonly cfg: NumbersData,
    private readonly rng: Rng,
  ) {
    ensurePixelFont(scene);
    for (const [name, s] of Object.entries(cfg.styles)) this.styles.set(name, { ...s, tint: parseColor(s.color) });
    this.pool = new CappedPool<Num>(
      () => ({
        text: scene.add
          .bitmapText(0, 0, PIXEL_FONT, '', 7)
          .setLetterSpacing(-1)
          .setOrigin(0.5, 1)
          .setDepth(Depth.DamageText)
          .setActive(false)
          .setVisible(false),
        x: 0,
        y: 0,
        ageMs: 0,
        lifeMs: 1,
        scale: 1,
        jitterPx: 0,
        jitterMs: 0,
        key: null,
        style: '',
        sum: 0,
      }),
      cfg.cap,
    );
  }

  /** 품질 옵션(D40): 동시 숫자 상한 낮추기 */
  setCap(n: number): void {
    this.pool.cap = Math.max(1, Math.min(this.pool.cap, Math.round(n)));
  }

  /** (x, y): 숫자가 시작할 월드 좌표(보통 맞은 몸통 위). value가 없으면 스타일의 text(예: KILL) */
  show(styleName: string, x: number, y: number, value?: number | string, key?: object): void {
    const st = this.styles.get(styleName);
    if (!st) return;
    // 같은 적이 mergeMs 안에 또 맞으면 새 숫자 대신 합산
    if (key && typeof value === 'number') {
      const merge = this.cfg.mergeMs ?? 0;
      for (const m of this.pool.active) {
        if (m.key === key && m.style === styleName && m.ageMs < merge) {
          m.sum += value;
          m.text.setText(String(Math.round(m.sum)));
          m.ageMs = 0;
          this.draw(m);
          return;
        }
      }
    }
    const label = value === undefined ? (st.text ?? '') : String(typeof value === 'number' ? Math.round(value) : value);
    if (!label) return;
    const { item: n } = this.pool.acquire();
    n.x = x + (this.rng.next() - 0.5) * this.cfg.spreadPx;
    n.y = y;
    n.ageMs = 0;
    n.lifeMs = st.lifeMs ?? this.cfg.lifeMs;
    n.scale = this.cfg.scale * st.scale;
    n.jitterPx = st.jitterPx ?? 0;
    n.jitterMs = st.jitterMs ?? 0;
    n.key = key ?? null;
    n.style = styleName;
    n.sum = typeof value === 'number' ? value : 0;
    n.text.setText(label).setTint(st.tint).setActive(true).setVisible(true);
    this.draw(n);
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return;
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i] as Num;
      n.ageMs += dtMs;
      if (n.ageMs >= n.lifeMs) {
        n.text.setActive(false).setVisible(false);
        this.pool.release(n);
        continue;
      }
      this.draw(n);
    }
  }

  private draw(n: Num): void {
    const a = numberAnim(n.ageMs, n.lifeMs, this.cfg);
    // 치명타 떨림: 처음 jitterMs 동안 좌우 ±jitterPx
    const jx = n.ageMs < n.jitterMs ? Math.round((this.rng.next() * 2 - 1) * n.jitterPx) : 0;
    n.text
      .setPosition(Math.round(n.x + jx), Math.round(n.y + a.dy))
      .setScale(n.scale * a.scaleMul)
      .setAlpha(a.alpha);
  }

  clear(): void {
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i] as Num;
      n.text.setActive(false).setVisible(false);
      this.pool.release(n);
    }
  }

  get active(): number {
    return this.pool.size;
  }
}
