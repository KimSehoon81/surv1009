import * as Phaser from 'phaser';
import stagesData from '../data/stages.json';
import cardsData from '../data/cards.json';
import combosData from '../data/combos.json';
import characters from '../data/characters.json';
import skillsData from '../data/skills.json';
import mapData from '../data/map.json';
import metaData from '../data/meta.json';
import { buyStartUpgrade, nextCost, openSlots, type StartUpgradeDef } from '../core/meta';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { addCard, available, countBy, maxCopies, recommendedDeck, removeCard, validateDeck, type DeckCard, type DeckError, type DeckRules } from '../core/deckBuild';
import type { Loadout } from '../core/save';
import { manifest } from '../assets/manifest';
import { isCharacterId, isImplemented, type CharacterId } from '../entities/Player';
import { InputMap } from '../systems/input';
import { loadProfile, updateProfile } from '../systems/save';
import { uiText } from '../ui/text';
import { FocusGroup, UI, UiButton, UiList, panel } from '../ui/widgets';
import type { BattlePayload, MapPayload, PrepPayload } from '../types/scenes';
import { SceneKey } from './keys';

const CARDS = cardsData.cards as Record<string, DeckCard>;
const RULES = cardsData.deckRules as DeckRules;
const TAG_NAMES = cardsData.tags as Record<string, string>;
const SKILLS = skillsData.skills as Record<string, { name: string; slot: string; tpCost: number; unlock: string; timeline?: string }>;
const DECK_ERR: Record<DeckError, string> = { size: `덱은 정확히 ${RULES.size}장`, copies: '같은 카드 장수 초과', locked: '잠긴 카드', minus: '마이너스 카드는 넣을 수 없음', unknown: '알 수 없는 카드' };

/**
 * 출정 준비(PRD §3): 좌 캐릭터 · 중 덱 20장 · 우 고급 스킬 슬롯·스타팅 포인트·지역 정보.
 * 키보드(←→ 칸 이동, ↑↓ 고르기, Enter, +/−, Esc)와 마우스 둘 다. 고른 구성은 저장되고 전투에 그대로 넘어간다.
 */
export class PrepScene extends Phaser.Scene {
  private controls!: InputMap;
  private payload!: PrepPayload;
  private loadout!: Loadout;
  private unlockedCards: string[] = [];
  private charList!: UiList;
  private deckList!: UiList;
  private skillList!: UiList;
  private shopList!: UiList;
  private meritText!: Phaser.GameObjects.Text;
  private deckTitle!: Phaser.GameObjects.Text;
  private charInfo!: Phaser.GameObjects.Text;
  private charImg!: Phaser.GameObjects.Image;
  private message!: Phaser.GameObjects.Text;
  private focus!: FocusGroup;

  constructor() {
    super(SceneKey.Prep);
  }

  init(data: PrepPayload): void {
    this.payload = data;
  }

  create(): void {
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    const prof = loadProfile();
    this.unlockedCards = prof.unlocks.cards ?? [];
    // 첫 판·저장 없음: 기본 덱 자동 적용
    const saved = prof.loadout;
    this.loadout = {
      char: saved && prof.unlocks.chars.includes(saved.char) ? saved.char : (prof.unlocks.chars[0] ?? 'A01'),
      deck: saved && validateDeck(saved.deck, CARDS, RULES, this.unlockedCards).length === 0 ? [...saved.deck] : [...cardsData.starterDeck],
      skills: { ...Object.fromEntries(skillsData.slots.map((s) => [s.key, s.equip])), ...(saved?.skills ?? {}) },
    };

    const st = (stagesData.stages as Record<string, { name: string; region: string }>)[this.payload.stage];
    this.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x14100c).setOrigin(0);
    this.add.text(12, 10, `출정 준비 — ${st?.region ?? ''} ${st?.name ?? this.payload.stage}`, uiText(18, UI.hi));

    // 좌: 캐릭터
    panel(this, 12, 40, 220, 400, '캐릭터');
    this.charList = new UiList(this, 16, 64, 212, 6);
    this.charImg = this.add.image(122, 300, manifest.sheetKey(this.loadout.char as CharacterId, 'move_slow'), 0).setScale(1.2);
    this.charInfo = this.add.text(20, 360, '', { ...uiText(12), lineSpacing: 4 });

    // 중: 덱
    panel(this, 244, 40, 340, 400);
    this.deckTitle = this.add.text(252, 46, '', uiText(13, UI.hi));
    this.deckList = new UiList(this, 248, 68, 332, 18);

    // 우: 스킬 슬롯·스타팅 포인트·지역 정보
    panel(this, 596, 40, 352, 400, '고급 스킬 슬롯');
    this.skillList = new UiList(this, 600, 64, 344, 4);
    this.add.text(604, 146, '스타팅 포인트 (Enter 구매)', uiText(13, UI.hi));
    this.meritText = this.add.text(940, 146, '', uiText(12, UI.hi)).setOrigin(1, 0);
    const hint = this.add.text(604, 270, '', uiText(11, UI.dim));
    this.shopList = new UiList(this, 600, 166, 344, 6, 17, (it) => hint.setText(it?.hint ?? ''));
    const node = mapData.nodes.find((n) => n.id === this.payload.stage);
    this.add.text(604, 290, '지역 정보', uiText(13, UI.hi));
    this.add.text(604, 310, node ? `주요 적: ${node.enemies}\n보스: ${node.boss}\n방해: ${node.disruption}\n대응: ${node.counter}` : '', { ...uiText(11), wordWrap: { width: 336 }, lineSpacing: 3 });

    // 아래: 덱 버튼 + 출정
    const by = 470;
    const btnRec = new UiButton(this, 296, by, '추천 덱', () => this.setDeck(recommendedDeck(CARDS, combosData.combos, RULES, this.unlockedCards), '추천 덱을 채웠습니다'));
    const btnDef = new UiButton(this, 384, by, '기본 덱', () => this.setDeck([...cardsData.starterDeck], '기본 덱'));
    const btnSave = new UiButton(this, 486, by, '프리셋 저장', () => this.savePreset());
    const btnLoad = new UiButton(this, 626, by, '프리셋 불러오기', () => this.loadPreset());
    const btnGo = new UiButton(this, 840, by, '▶ 출정 (Enter)', () => this.sortie());
    this.add.text(12, LOGICAL_HEIGHT - 22, '←→ 칸 이동 · ↑↓ 고르기 · Enter 실행 · +/− 덱 장수 · Esc 작전지도', uiText(11, UI.dim));
    this.message = this.add.text(LOGICAL_WIDTH / 2, by + 34, '', uiText(12, UI.hi)).setOrigin(0.5);

    this.focus = new FocusGroup([this.charList, this.deckList, this.skillList, this.shopList, btnRec, btnDef, btnSave, btnLoad, btnGo]);
    // 첫 포커스는 출정: 기본 구성 그대로 Enter 한 번이면 출정
    this.focus.focus(8);
    this.refresh();
  }

  private say(msg: string, color: string = UI.hi): void {
    this.message.setText(msg).setColor(color);
  }

  private setDeck(deck: string[], msg?: string): void {
    this.loadout.deck = deck;
    if (msg) this.say(msg);
    this.refresh();
  }

  private savePreset(): void {
    const deck = [...this.loadout.deck];
    updateProfile((d) => {
      d.deckPreset = deck;
    });
    this.say('덱 프리셋 저장');
  }

  private loadPreset(): void {
    const p = loadProfile().deckPreset;
    if (!p) this.say('저장된 프리셋이 없습니다', UI.bad);
    else this.setDeck([...p], '프리셋을 불러왔습니다');
  }

  private refresh(): void {
    const prof = loadProfile();
    const l = this.loadout;
    // 캐릭터
    this.charList.setItems(
      // 해금됐고 구현된 캐릭터만(미구현 골격은 숨김)
      prof.unlocks.chars.filter(isImplemented).map((id) => {
        const c = characters.characters[id];
        return {
          label: `${id === l.char ? '● ' : '  '}${c.name}`,
          color: id === l.char ? UI.hi : UI.text,
          onSelect: () => {
            l.char = id;
            this.refresh();
          },
        };
      }),
    );
    if (isCharacterId(l.char)) {
      const c = characters.characters[l.char];
      this.charImg.setTexture(manifest.sheetKey(l.char, 'move_slow'), 0);
      this.charInfo.setText(`${c.name} (${c.role})\n체력 ${c.stats.hp} · 공격 ${c.stats.attack} · 이동 ${c.stats.moveSpeed}`);
    }
    // 덱
    const counts = countBy(l.deck);
    const avail = available(CARDS, RULES, this.unlockedCards);
    const errs = validateDeck(l.deck, CARDS, RULES, this.unlockedCards);
    this.deckTitle.setText(`덱 ${l.deck.length}/${RULES.size}${errs.length > 0 ? `  ⚠ ${errs.map((e) => DECK_ERR[e]).join(', ')}` : ''}`).setColor(errs.length > 0 ? UI.bad : UI.hi);
    this.deckList.setItems(
      avail.map((id) => {
        const c = CARDS[id];
        const n = counts.get(id) ?? 0;
        return {
          label: `${c?.name ?? id} · ${TAG_NAMES[c?.tag ?? ''] ?? ''}`,
          right: `${n}/${maxCopies(c, RULES)}`,
          color: n > 0 ? UI.text : UI.dim,
          onSelect: () => this.setDeck(addCard(l.deck, id, CARDS, RULES, this.unlockedCards)),
          onAdjust: (d: number) => this.setDeck(d > 0 ? addCard(l.deck, id, CARDS, RULES, this.unlockedCards) : removeCard(l.deck, id)),
        };
      }),
    );
    // 스타팅 포인트 상점(§8.2)
    const defs = metaData.startUpgrades as Record<string, StartUpgradeDef>;
    this.meritText.setText(`전공 ${prof.merit}`);
    this.shopList.setItems(
      Object.entries(defs).map(([id, d]) => {
        const lv = prof.startUpgrades[id] ?? 0;
        const cost = nextCost(prof, id, defs);
        return {
          label: `${d.name} ${lv}/${d.maxLevel}`,
          right: cost === null ? '최대' : `${cost}`,
          color: cost !== null && prof.merit >= cost ? UI.text : UI.dim,
          hint: d.effect,
          onSelect: () => {
            const r = buyStartUpgrade(loadProfile(), id, defs);
            if (r.ok) {
              updateProfile(() => r.save);
              this.say(`${d.name} 강화! (${d.effect})`, UI.good);
            } else this.say(r.error === 'merit' ? '전공 포인트가 모자랍니다' : r.error === 'max' ? '이미 최대 단계' : '알 수 없는 항목', UI.bad);
            this.refresh();
          },
        };
      }),
    );
    // 스킬 슬롯: 열린 슬롯만 장착(세이브 해금), Enter로 해금된 스킬 중 돌려 고르기
    const open = openSlots(prof);
    this.skillList.setItems(
      skillsData.slots.map((slot) => {
        const choices = prof.unlocks.skills.filter((id) => SKILLS[id]?.slot === slot.key);
        const cur = l.skills[slot.key];
        const def = cur ? SKILLS[cur] : undefined;
        if (!open.includes(slot.key)) {
          const next = Object.values(SKILLS).find((s) => s.slot === slot.key);
          return { label: `${slot.key}  잠김`, right: next ? `${next.unlock}` : '', disabled: true };
        }
        return {
          label: `${slot.key}  ${def?.name ?? '비어 있음'}`,
          right: def ? `TP ${def.tpCost}` : '',
          onSelect: () => {
            if (choices.length === 0) return;
            const i = cur ? choices.indexOf(cur) : -1;
            l.skills[slot.key] = choices[(i + 1) % choices.length] ?? null;
            this.refresh();
          },
        };
      }),
    );
  }

  private sortie(): void {
    const l = this.loadout;
    const errs = validateDeck(l.deck, CARDS, RULES, this.unlockedCards);
    if (errs.length > 0) {
      this.say(`출정 불가: ${errs.map((e) => DECK_ERR[e]).join(', ')}`, UI.bad);
      return;
    }
    const loadout: Loadout = { char: l.char, deck: [...l.deck], skills: { ...l.skills } };
    updateProfile((d) => {
      d.loadout = loadout;
    });
    const payload: BattlePayload = { stage: this.payload.stage, char: (isCharacterId(l.char) ? l.char : 'A01') as CharacterId, deck: loadout.deck, skills: loadout.skills };
    this.scene.start(SceneKey.Battle, payload);
  }

  override update(): void {
    const c = this.controls;
    if (c.justDown('uiBack')) {
      const payload: MapPayload = { focus: this.payload.stage };
      this.scene.start(SceneKey.Map, payload);
    } else this.focus.handle(c);
    c.endFrame();
  }
}
