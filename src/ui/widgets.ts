import * as Phaser from 'phaser';
import type { InputMap } from '../systems/input';
import { uiText } from './text';

// 공용 UI 위젯(출정 준비·상점·설정·도감): 패널·버튼·목록 + 포커스 묶음.
// 키보드(방향키·Enter·Esc·+/−)와 마우스(클릭·[−][+]) 둘 다. 색은 한곳에서.

export const UI = {
  bg: 0x1a1610,
  border: 0x6a5a40,
  focus: 0xffe14d,
  text: '#e8dcc0',
  dim: '#807868',
  hi: '#ffe14d',
  bad: '#ff8060',
  good: '#6fd06f',
};

/** 테두리 있는 배경 + 제목 */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, title?: string): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y);
  c.add(scene.add.rectangle(0, 0, w, h, UI.bg, 0.92).setOrigin(0).setStrokeStyle(1, UI.border));
  if (title) c.add(scene.add.text(8, 6, title, uiText(13, UI.hi)));
  return c;
}

export interface Focusable {
  focused: boolean;
  move(delta: number): void;
  activate(): void;
  adjust(delta: number): void;
  render(): void;
}

export interface ListItem {
  label: string;
  /** 오른쪽 작은 글씨(장수·비용 등) */
  right?: string;
  color?: string;
  disabled?: boolean;
  /** Enter·클릭 */
  onSelect?(): void;
  /** +/− 키, 마우스 [−][+] */
  onAdjust?(delta: number): void;
  /** 포커스했을 때 보여 줄 설명 */
  hint?: string;
}

/** 세로 목록: 한 화면에 rows줄, 포커스가 넘치면 스크롤 */
export class UiList implements Focusable {
  focused = false;
  index = 0;
  private items: ListItem[] = [];
  private top = 0;
  private readonly rowsUi: { label: Phaser.GameObjects.Text; right: Phaser.GameObjects.Text; minus: Phaser.GameObjects.Text; plus: Phaser.GameObjects.Text }[] = [];
  private readonly cursor: Phaser.GameObjects.Rectangle;

  constructor(
    scene: Phaser.Scene,
    private readonly x: number,
    private readonly y: number,
    private readonly w: number,
    private readonly rows: number,
    private readonly rowH = 18,
    private readonly onFocus?: (item: ListItem | undefined) => void,
  ) {
    this.cursor = scene.add.rectangle(x, y, w, rowH, UI.focus, 0.12).setOrigin(0).setStrokeStyle(1, UI.focus, 0.8);
    for (let r = 0; r < rows; r++) {
      const ry = y + r * rowH + 2;
      const label = scene.add.text(x + 4, ry, '', uiText(12)).setInteractive({ useHandCursor: true });
      const right = scene.add.text(x + w - 44, ry, '', uiText(12)).setOrigin(1, 0);
      const minus = scene.add.text(x + w - 38, ry, '[−]', uiText(12, UI.hi)).setInteractive({ useHandCursor: true });
      const plus = scene.add.text(x + w - 18, ry, '[+]', uiText(12, UI.hi)).setInteractive({ useHandCursor: true });
      label.on('pointerdown', () => this.clickRow(r, 0));
      minus.on('pointerdown', () => this.clickRow(r, -1));
      plus.on('pointerdown', () => this.clickRow(r, 1));
      this.rowsUi.push({ label, right, minus, plus });
    }
  }

  setItems(items: ListItem[]): void {
    this.items = items;
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
    this.render();
  }

  get current(): ListItem | undefined {
    return this.items[this.index];
  }

  private clickRow(r: number, delta: number): void {
    const i = this.top + r;
    if (!this.items[i]) return;
    this.index = i;
    if (delta === 0) this.activate();
    else this.adjust(delta);
    this.render();
  }

  move(delta: number): void {
    if (this.items.length === 0) return;
    this.index = (this.index + delta + this.items.length) % this.items.length;
    this.render();
  }

  activate(): void {
    const it = this.items[this.index];
    if (it && !it.disabled) it.onSelect?.();
  }

  adjust(delta: number): void {
    const it = this.items[this.index];
    if (it && !it.disabled) it.onAdjust?.(delta);
  }

  render(): void {
    if (this.index < this.top) this.top = this.index;
    if (this.index >= this.top + this.rows) this.top = this.index - this.rows + 1;
    this.rowsUi.forEach((ui, r) => {
      const it = this.items[this.top + r];
      ui.label.setText(it?.label ?? '').setColor(it?.disabled ? UI.dim : (it?.color ?? UI.text));
      ui.right.setText(it?.right ?? '').setColor(it?.disabled ? UI.dim : UI.text);
      const adj = Boolean(it?.onAdjust) && !it?.disabled;
      ui.minus.setVisible(adj);
      ui.plus.setVisible(adj);
      ui.right.setX(adj ? this.x + this.w - 44 : this.x + this.w - 4);
    });
    const r = this.index - this.top;
    this.cursor.setVisible(this.items.length > 0).setPosition(this.x, this.y + r * this.rowH);
    this.cursor.setStrokeStyle(1, UI.focus, this.focused ? 0.9 : 0.25).setFillStyle(UI.focus, this.focused ? 0.14 : 0.04);
    this.onFocus?.(this.focused ? this.items[this.index] : undefined);
  }
}

/** 버튼(포커스 묶음에 한 칸으로 들어갈 수 있음) */
export class UiButton implements Focusable {
  focused = false;
  private readonly text: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    label: string,
    private readonly onClick: () => void,
  ) {
    this.text = scene.add
      .text(x, y, label, { ...uiText(14), backgroundColor: '#2a2216', padding: { x: 10, y: 5 } })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.onClick());
  }

  setLabel(label: string): void {
    this.text.setText(label);
  }

  move(): void {}

  activate(): void {
    this.onClick();
  }

  adjust(): void {}

  render(): void {
    this.text.setColor(this.focused ? UI.hi : UI.text).setBackgroundColor(this.focused ? '#4a3a20' : '#2a2216');
  }
}

/**
 * 포커스 묶음: 칸(목록·버튼)들 사이를 ←→로, 칸 안은 ↑↓, Enter 실행, +/− 조절. 마우스는 각 위젯이 직접.
 */
export class FocusGroup {
  index = 0;

  constructor(private readonly items: Focusable[]) {
    this.apply();
  }

  focus(i: number): void {
    this.index = Math.max(0, Math.min(this.items.length - 1, i));
    this.apply();
  }

  private apply(): void {
    this.items.forEach((it, i) => {
      it.focused = i === this.index;
      it.render();
    });
  }

  handle(c: InputMap): void {
    const cur = this.items[this.index];
    if (!cur) return;
    if (c.justDown('uiLeft')) this.focus((this.index + this.items.length - 1) % this.items.length);
    else if (c.justDown('uiRight')) this.focus((this.index + 1) % this.items.length);
    else if (c.justDown('uiUp')) cur.move(-1);
    else if (c.justDown('uiDown')) cur.move(1);
    else if (c.justDown('uiConfirm')) cur.activate();
    else if (c.justDown('uiInc')) cur.adjust(1);
    else if (c.justDown('uiDec')) cur.adjust(-1);
  }
}
