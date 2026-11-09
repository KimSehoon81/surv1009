import * as Phaser from 'phaser';
import controls from '../data/controls.json';
import settingsData from '../data/settings.json';
import { effectiveKeys, rebind } from '../core/keymap';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { loadProfile, updateProfile } from '../systems/save';
import { FocusGroup, UI, UiList, panel, type ListItem } from '../ui/widgets';
import { uiText } from '../ui/text';
import { SceneKey } from './keys';

type Tab = (typeof settingsData.tabs)[number];
type Option = Tab['options'][number] & { hint?: string };
const DEFAULTS = settingsData.defaults as Record<string, number | boolean>;
const REMAP = settingsData.keys.remappable as Record<string, string>;
const DEF_KEYS = controls.keys as Record<string, string[]>;
const KEY_NAMES = Object.entries(Phaser.Input.Keyboard.KeyCodes).reduce<Record<number, string>>((m, [name, code]) => ((m[code as number] ??= name), m), {});
const PRETTY: Record<string, string> = { ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SPACE: 'Space', ENTER: 'Enter', ESC: 'Esc', SHIFT: 'Shift', BACKSPACE: 'Backspace', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', TAB: 'Tab' };
const pretty = (k: string) => PRETTY[k] ?? k;

/** 설정(PRD §11, D29): 기본(강도·볼륨·모노·안내) / 편의 / 키 재설정. ←→ 칸, ↑↓ 고르기, Enter·+/− 바꾸기, Esc 돌아가기 */
export class SettingsScene extends Phaser.Scene {
  private controls!: InputMap;
  private focus!: FocusGroup;
  private tabs!: UiList;
  private list!: UiList;
  private hint!: Phaser.GameObjects.Text;
  private tab = 0;
  /** 키 재설정: 새 키를 기다리는 액션 */
  private capture: string | null = null;
  private captureEndedAt = -1;
  private back: string = SceneKey.Menu;

  constructor() {
    super(SceneKey.Settings);
  }

  create(data: { back?: string } = {}): void {
    this.back = data.back ?? SceneKey.Menu;
    this.tab = 0;
    this.capture = null;
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    this.add.text(16, 12, '설정', uiText(20, UI.hi));
    this.add.existing(panel(this, 16, 48, 190, 140));
    this.add.existing(panel(this, 220, 48, LOGICAL_WIDTH - 236, LOGICAL_HEIGHT - 110));
    this.tabs = new UiList(this, 24, 60, 174, 4, 24);
    this.list = new UiList(this, 228, 60, LOGICAL_WIDTH - 252, 17, 24, (it) => {
      if (!this.capture) this.hint.setText(it?.hint ?? '').setColor(UI.text);
    });
    this.hint = this.add.text(228, LOGICAL_HEIGHT - 52, '', uiText(12, UI.text)).setWordWrapWidth(LOGICAL_WIDTH - 250);
    this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 18, '←→ 칸 · ↑↓ 고르기 · Enter·+/− 바꾸기 · Esc 돌아가기', uiText(11, UI.dim)).setOrigin(0.5);
    this.focus = new FocusGroup([this.tabs, this.list]);
    this.focus.focus(1);
    this.input.keyboard?.on('keydown', this.onKeyDown);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', this.onKeyDown));
    this.refresh();
  }

  private refresh(): void {
    this.tabs.setItems(
      settingsData.tabs.map((t, i) => ({
        label: `${i === this.tab ? '▶ ' : '  '}${t.name}`,
        color: i === this.tab ? UI.hi : UI.text,
        onSelect: () => {
          this.tab = i;
          this.list.index = 0;
          this.refresh();
          this.focus.focus(1);
        },
      })),
    );
    const t = settingsData.tabs[this.tab] as Tab;
    this.list.setItems(t.id === 'keys' ? this.keyItems() : t.options.map((o) => this.optionItem(o as Option)));
  }

  private read(key: string): number | boolean {
    const s = loadProfile().settings as unknown as Record<string, unknown>;
    if (key.startsWith('volume.')) return (s.volume as Record<string, number>)[key.slice(7)] ?? 1;
    const v = s[key];
    return typeof v === 'number' || typeof v === 'boolean' ? v : (DEFAULTS[key] ?? true);
  }

  private write(key: string, v: number | boolean): void {
    updateProfile((d) => {
      const s = d.settings as unknown as Record<string, unknown>;
      if (key.startsWith('volume.')) (s.volume as Record<string, number>)[key.slice(7)] = v as number;
      else s[key] = v;
    });
    this.refresh();
  }

  private optionItem(o: Option): ListItem {
    const v = this.read(o.key);
    if (o.kind === 'percent') {
      const n = typeof v === 'number' ? v : 1;
      const step = (d: number) => this.write(o.key, Math.round(Math.max(0, Math.min(1, n + d * 0.1)) * 10) / 10);
      return { label: o.label, right: `${Math.round(n * 100)}%`, hint: o.hint ?? '+/− 또는 [−][+]로 10%씩', onAdjust: step, onSelect: () => this.write(o.key, n >= 1 ? 0 : Math.round((n + 0.1) * 10) / 10) };
    }
    return { label: o.label, right: v ? '켬' : '끔', color: v ? UI.text : UI.dim, hint: o.hint, onSelect: () => this.write(o.key, !v), onAdjust: () => this.write(o.key, !v) };
  }

  private keyItems(): ListItem[] {
    const keys = effectiveKeys(DEF_KEYS, loadProfile().settings.keys);
    const items: ListItem[] = Object.entries(REMAP).map(([action, label]) => ({
      label,
      right: (keys[action] ?? []).map(pretty).join(' / '),
      hint: 'Enter를 누른 뒤 새 키(첫 키만 바뀌고 방향키 등 대체 키는 유지)',
      onSelect: () => {
        this.capture = action;
        this.hint.setText(`'${label}'에 쓸 키를 누르세요 (Esc 취소)`).setColor(UI.hi);
      },
    }));
    items.push({ label: '기본값 복원', color: UI.bad, hint: '모든 키를 처음 배치로', onSelect: () => this.resetKeys() });
    return items;
  }

  private resetKeys(): void {
    updateProfile((d) => {
      delete d.settings.keys;
    });
    this.refresh();
    this.hint.setText('키 배치를 기본값으로 되돌렸습니다').setColor(UI.good);
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    const action = this.capture;
    if (!action) return;
    const name = KEY_NAMES[ev.keyCode];
    this.capture = null;
    this.captureEndedAt = this.game.loop.frame;
    if (!name || name === 'ESC') {
      this.hint.setText('취소').setColor(UI.dim);
      return;
    }
    const r = rebind(DEF_KEYS, loadProfile().settings.keys, action, name, settingsData.keys.conflictGroup);
    if (!r.ok) {
      const who = REMAP[r.conflict] ?? r.conflict;
      this.hint.setText(`${pretty(name)}: 이미 '${who}'에 쓰는 키입니다`).setColor(UI.bad);
      return;
    }
    updateProfile((d) => {
      d.settings.keys = r.overrides as Record<string, string[]>;
    });
    this.refresh();
    this.hint.setText(`'${REMAP[action]}' = ${pretty(name)} (다음 전투부터 적용)`).setColor(UI.good);
  };

  override update(): void {
    const c = this.controls;
    // 키를 기다리는 중·방금 받은 프레임은 메뉴 조작으로 쓰지 않음
    if (this.capture || this.game.loop.frame === this.captureEndedAt) {
      c.endFrame();
      return;
    }
    if (c.justDown('uiBack')) this.scene.start(this.back);
    else this.focus.handle(c);
    c.endFrame();
  }
}
