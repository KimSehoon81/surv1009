import * as Phaser from 'phaser';
import charactersData from '../data/characters.json';
import enemiesData from '../data/enemies.json';
import cardsData from '../data/cards.json';
import achievementsData from '../data/achievements.json';
import { emptyAchievements, emptyCodex, progressOf, type AchievementDef } from '../core/achievements';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { InputMap } from '../systems/input';
import { loadProfile } from '../systems/save';
import { FocusGroup, UI, UiList, panel, type ListItem } from '../ui/widgets';
import { uiText } from '../ui/text';
import { SceneKey } from './keys';
import { t } from '../i18n';

const TABS = ['chars', 'enemies', 'cards', 'ach'] as const;
const tabName = (i: number): string => t(`codex.tab.${TABS[i] ?? 'chars'}`);
const CH = charactersData.characters as Record<string, { name: string; role: string; faction: string; unlock: string }>;
const EN = enemiesData.enemies as Record<string, { name: string; tier: string }>;
const CA = cardsData.cards as Record<string, { name: string; tag: string; desc?: string }>;
const ACH = achievementsData.achievements as AchievementDef[];

/** 도감·업적(D41): 캐릭터(해금)·적(처치)·카드(손에 들어옴)·업적(진행도). 모르는 것은 ??? */
export class CodexScene extends Phaser.Scene {
  private controls!: InputMap;
  private focus!: FocusGroup;
  private tabs!: UiList;
  private list!: UiList;
  private detail!: Phaser.GameObjects.Text;
  private count!: Phaser.GameObjects.Text;
  private tab = 0;

  constructor() {
    super(SceneKey.Codex);
  }

  create(): void {
    this.tab = 0;
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    this.add.text(16, 12, t('codex.title'), uiText(20, UI.hi));
    this.count = this.add.text(LOGICAL_WIDTH - 16, 16, '', uiText(13, UI.text)).setOrigin(1, 0);
    panel(this, 16, 48, 150, 130);
    panel(this, 180, 48, 380, LOGICAL_HEIGHT - 90);
    panel(this, 574, 48, LOGICAL_WIDTH - 590, LOGICAL_HEIGHT - 90);
    this.tabs = new UiList(this, 24, 60, 134, 4, 24);
    this.list = new UiList(this, 188, 60, 364, 17, 24, (it) => this.detail.setText(it?.hint ?? ''));
    this.detail = this.add.text(586, 62, '', uiText(13, UI.text)).setWordWrapWidth(LOGICAL_WIDTH - 614).setLineSpacing(6);
    this.add.text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 18, t('codex.help'), uiText(11, UI.dim)).setOrigin(0.5);
    this.focus = new FocusGroup([this.tabs, this.list]);
    this.focus.focus(1);
    this.refresh();
  }

  private refresh(): void {
    this.tabs.setItems(
      TABS.map((_, i) => ({
        label: `${i === this.tab ? '▶ ' : '  '}${tabName(i)}`,
        color: i === this.tab ? UI.hi : UI.text,
        onSelect: () => {
          this.tab = i;
          this.list.index = 0;
          this.refresh();
          this.focus.focus(1);
        },
      })),
    );
    const prof = loadProfile();
    const codex = prof.codex ?? emptyCodex();
    const ach = prof.achievements ?? emptyAchievements();
    let items: ListItem[] = [];
    let seen = 0;
    let total = 0;
    if (this.tab === 0) {
      const ids = Object.keys(CH);
      items = ids.map((id) => {
        const c = CH[id];
        const has = prof.unlocks.chars.includes(id);
        return { label: has ? `${id}  ${c?.name ?? id}` : `${id}  ???`, color: has ? UI.text : UI.dim, hint: has ? `${c?.name}\n${c?.faction} · ${c?.role}` : t('codex.charLocked', { stage: c?.unlock ?? '?' }) };
      });
      seen = ids.filter((id) => prof.unlocks.chars.includes(id)).length;
      total = ids.length;
    } else if (this.tab === 1) {
      const ids = Object.keys(EN);
      items = ids.map((id) => {
        const e = EN[id];
        const has = codex.enemies.includes(id);
        return { label: has ? `${id}  ${e?.name ?? id}` : `${id}  ???`, color: has ? UI.text : UI.dim, hint: has ? `${e?.name}\n${e?.tier ? t(`codex.tier.${e.tier}`) : ''}` : t('codex.enemyLocked') };
      });
      seen = ids.filter((id) => codex.enemies.includes(id)).length;
      total = ids.length;
    } else if (this.tab === 2) {
      const ids = Object.keys(CA);
      items = ids.map((id) => {
        const c = CA[id];
        const has = codex.cards.includes(id);
        return { label: has ? `${id}  ${c?.name ?? id}` : `${id}  ???`, color: has ? UI.text : UI.dim, hint: has ? `${c?.name}\n${c?.desc ?? ''}` : t('codex.cardLocked') };
      });
      seen = ids.filter((id) => codex.cards.includes(id)).length;
      total = ids.length;
    } else {
      items = ACH.map((d) => {
        const done = ach.done.includes(d.id);
        const p = Math.round(progressOf(ach, d) * 100);
        return { label: `${done ? '✓' : '  '} ${d.name}`, right: done ? t('codex.done') : `${p}%`, color: done ? UI.good : UI.text, hint: `${d.name}\n${d.desc}\n${t('codex.progress', { n: Math.min(d.target, ach.counters[d.id] ?? 0), target: d.target })}${d.reward ? `\n${t('codex.reward', { n: d.reward })}` : ''}` };
      });
      seen = ach.done.length;
      total = ACH.length;
    }
    this.list.setItems(items);
    this.count.setText(`${tabName(this.tab)} ${seen}/${total}`);
  }

  override update(): void {
    const c = this.controls;
    if (c.justDown('uiBack')) this.scene.start(SceneKey.Menu);
    else this.focus.handle(c);
    c.endFrame();
  }
}
