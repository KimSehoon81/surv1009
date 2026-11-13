import * as Phaser from 'phaser';
import controls from '../data/controls.json';
import settingsData from '../data/settings.json';
import { conflicts, effectiveKeys, rebind } from '../core/keymap';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { loadProfile, updateProfile } from '../systems/save';
import { FocusGroup, UI, UiList, panel, type ListItem } from '../ui/widgets';
import { uiText } from '../ui/text';
import { SceneKey } from './keys';
import { setLocale, t } from '../i18n';

type Tab = (typeof settingsData.tabs)[number];
type Option = Tab['options'][number] & { hint?: string; choices?: string[]; names?: Record<string, string> };
const DEFAULTS = settingsData.defaults as unknown as Record<string, number | boolean | string>;
const Q = settingsData.quality;
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
    this.add.text(16, 12, t('settings.title'), uiText(20, UI.hi));
    panel(this, 16, 48, 190, 140);
    panel(this, 220, 48, LOGICAL_WIDTH - 236, LOGICAL_HEIGHT - 110);
    this.tabs = new UiList(this, 24, 60, 174, 4, 24);
    this.list = new UiList(this, 228, 60, LOGICAL_WIDTH - 252, 17, 24, (it) => {
      if (!this.capture) this.hint.setText(it?.hint ?? '').setColor(UI.text);
    });
    this.hint = this.add.text(228, LOGICAL_HEIGHT - 52, '', uiText(12, UI.text)).setWordWrapWidth(LOGICAL_WIDTH - 250);
    this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 18, t('settings.help'), uiText(11, UI.dim)).setOrigin(0.5);
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

  private read(key: string): number | boolean | string {
    const s = loadProfile().settings as unknown as Record<string, unknown>;
    if (key.startsWith('volume.')) return (s.volume as Record<string, number>)[key.slice(7)] ?? 1;
    const v = s[key];
    return typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : (DEFAULTS[key] ?? true);
  }

  private write(key: string, v: number | boolean | string): void {
    updateProfile((d) => {
      const s = d.settings as unknown as Record<string, unknown>;
      if (key.startsWith('volume.')) (s.volume as Record<string, number>)[key.slice(7)] = v as number;
      else s[key] = v;
    });
    // 언어는 모듈 수준에서 만든 이름표까지 바꿔야 해서 다시 불러옴
    if (key === 'lang' && setLocale(String(v)) && typeof window !== 'undefined') window.location.reload();
    this.refresh();
  }

  private optionItem(o: Option): ListItem {
    const v = this.read(o.key);
    if (o.kind === 'choice') {
      // 목록 차례로 순환(이펙트 품질: 높음 → 보통 → 낮음, 언어: 한국어 → English)
      const order = o.choices ?? Q.order;
      const names = (o.names ?? Q.names) as Record<string, string>;
      const i = Math.max(0, order.indexOf(String(v)));
      const step = (d: number) => this.write(o.key, order[(i + d + order.length) % order.length] ?? order[0] ?? '');
      return { label: o.label, right: names[String(v)] ?? String(v), hint: o.hint, onSelect: () => step(1), onAdjust: step };
    }
    if (o.kind === 'percent') {
      const n = typeof v === 'number' ? v : 1;
      const step = (d: number) => this.write(o.key, Math.round(Math.max(0, Math.min(1, n + d * 0.1)) * 10) / 10);
      return { label: o.label, right: `${Math.round(n * 100)}%`, hint: o.hint ?? t('settings.percentHint'), onAdjust: step, onSelect: () => this.write(o.key, n >= 1 ? 0 : Math.round((n + 0.1) * 10) / 10) };
    }
    return { label: o.label, right: v ? t('settings.on') : t('settings.off'), color: v ? UI.text : UI.dim, hint: o.hint, onSelect: () => this.write(o.key, !v), onAdjust: () => this.write(o.key, !v) };
  }

  private keyItems(): ListItem[] {
    const keys = effectiveKeys(DEF_KEYS, loadProfile().settings.keys);
    const clash = conflicts(DEF_KEYS, keys, settingsData.keys.conflictGroup);
    const items: ListItem[] = Object.entries(REMAP).map(([action, label]) => ({
      label: clash[action] ? `⚠ ${label}` : label,
      right: (keys[action] ?? []).map(pretty).join(' / '),
      color: clash[action] ? UI.bad : undefined,
      hint: clash[action] ? t('settings.keyClash', { list: clash[action].map((a) => REMAP[a] ?? a).join(', ') }) : t('settings.keyHint'),
      onSelect: () => {
        this.capture = action;
        this.hint.setText(t('settings.pressKey', { label })).setColor(UI.hi);
      },
    }));
    items.push({ label: t('settings.resetKeys'), color: UI.bad, hint: t('settings.resetKeysHint'), onSelect: () => this.resetKeys() });
    return items;
  }

  private resetKeys(): void {
    updateProfile((d) => {
      delete d.settings.keys;
    });
    this.refresh();
    this.hint.setText(t('settings.keysReset')).setColor(UI.good);
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    const action = this.capture;
    if (!action) return;
    const name = KEY_NAMES[ev.keyCode];
    this.capture = null;
    this.captureEndedAt = this.game.loop.frame;
    if (!name || name === 'ESC') {
      this.hint.setText(t('settings.cancelled')).setColor(UI.dim);
      return;
    }
    const r = rebind(DEF_KEYS, loadProfile().settings.keys, action, name, settingsData.keys.conflictGroup);
    if (!r.ok) {
      const who = REMAP[r.conflict] ?? r.conflict;
      this.hint.setText(t('settings.conflict', { key: pretty(name), who })).setColor(UI.bad);
      return;
    }
    updateProfile((d) => {
      d.settings.keys = r.overrides as Record<string, string[]>;
    });
    this.refresh();
    this.hint.setText(t('settings.rebound', { label: REMAP[action] ?? action, key: pretty(name) })).setColor(UI.good);
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
