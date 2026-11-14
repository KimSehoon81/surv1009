// 성장 지도(거미줄형 캐릭터 성장, 2026-11-14): 가운데 캐릭터에서 6갈래로 뻗은 칸을 숙련 포인트로 연다.
// 1단계는 언제나, 같은 갈래는 안→밖, 2·4단계 고리는 옆 갈래로도 이어짐. 고유 갈래는 캐릭터 계열마다 다름(skillWeb.json)
import * as Phaser from 'phaser';
import webJson from '../data/skillWeb.json';
import characters from '../data/characters.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { buildWeb, checkUnlock, formatMod, isReachable, masteryLevel, points, resetWeb, summarize, unlockNode, webEffects, type CharWeb, type WebData, type WebGraph, type WebNode } from '../core/web';
import { parseColor } from '../core/feel';
import { manifest } from '../assets/manifest';
import { isCharacterId } from '../entities/Player';
import { InputMap } from '../systems/input';
import { loadProfile, updateProfile } from '../systems/save';
import { frontSfx, playMenuMusic } from '../systems/frontAudio';
import { uiText } from '../ui/text';
import { UI } from '../ui/widgets';
import { buttonLabel } from '../ui/buttons';
import { t } from '../i18n';
import type { PrepPayload, WebPayload } from '../types/scenes';
import { SceneKey } from './keys';

interface Layout {
  cx: number;
  cy: number;
  radii: number[];
  labelRadius: number;
}
const DATA = webJson as unknown as WebData & { layout: Layout };
const L = DATA.layout;
/** 줄어드는 쪽이 좋은 합 능력치(인장 필요 OP −1) */
const INVERSE = new Set(['sealOpReduction']);
const ICON: Record<string, string> = {
  attack: 'icon_upgrade_attack',
  attackSpeed: 'icon_upgrade_attack_speed',
  critChance: 'icon_upgrade_crit_chance',
  critMult: 'icon_upgrade_crit_damage',
  defense: 'icon_upgrade_defense',
  hp: 'icon_upgrade_hp',
  moveSpeed: 'icon_upgrade_speed',
  magnet: 'icon_upgrade_magnet',
  range: 'icon_upgrade_range',
  luck: 'icon_upgrade_luck',
  drawSpeed: 'icon_upgrade_draw_speed',
  sealOpReduction: 'seal',
  damageMult: 'icon_upgrade_weapon_rifle',
  cooldownMs: 'icon_upgrade_attack_speed',
  pierce: 'icon_upgrade_weapon_rifle',
  aoeRadius: 'icon_upgrade_weapon_grenade',
  auraRadius: 'icon_upgrade_defense',
  meleeRadius: 'icon_upgrade_attack',
  knockback: 'icon_upgrade_attack',
  tp: 'tp',
  seals: 'seal',
};
const firstStat = (n: WebNode): string => n.player?.[0]?.stat ?? n.weapons?.[0]?.stat ?? (n.start?.tp ? 'tp' : 'seals');
const NODE_R = [0, 15, 15, 17, 17];

/** 효과 한 줄들(칸 설명·합계 공용) */
function effectLines(n: Pick<WebNode, 'player' | 'weapons' | 'start'>): string[] {
  return summarize(webEffects({ nodes: [{ ...n, id: 'x', name: '', branch: '', ring: 1, cost: 0 }], links: [], archetype: '' }, ['x'])).map(
    (s) => `${t(`web.stat.${s.stat}`)} ${formatMod(s.op, s.value, INVERSE.has(s.stat))}`,
  );
}

export class WebScene extends Phaser.Scene {
  private controls!: InputMap;
  private payload!: WebPayload;
  private graph!: WebGraph;
  private pos = new Map<string, { x: number; y: number }>();
  private sel = '';
  private armedReset = false;
  private linkGfx!: Phaser.GameObjects.Graphics;
  private nodeGfx!: Phaser.GameObjects.Graphics;
  private fxGfx!: Phaser.GameObjects.Graphics;
  private icons = new Map<string, Phaser.GameObjects.Image>();
  private head!: Phaser.GameObjects.Text;
  private xpBar!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private status!: Phaser.GameObjects.Text;
  private total!: Phaser.GameObjects.Text;
  private message!: Phaser.GameObjects.Text;
  private bursts: { x: number; y: number; at: number; color: number }[] = [];

  constructor() {
    super(SceneKey.Web);
  }

  init(data: WebPayload): void {
    this.payload = data;
    this.sel = '';
    this.armedReset = false;
    this.bursts = [];
    this.pos = new Map();
    this.icons = new Map();
  }

  create(): void {
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    playMenuMusic(this);
    const char = this.payload.char;
    this.graph = buildWeb(DATA, char);
    for (const n of this.graph.nodes) {
      const b = DATA.branches.find((x) => x.id === n.branch);
      const a = ((b?.angle ?? 0) * Math.PI) / 180;
      const r = L.radii[n.ring] ?? 0;
      this.pos.set(n.id, { x: Math.round(L.cx + Math.cos(a) * r), y: Math.round(L.cy + Math.sin(a) * r) });
    }

    this.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x100c08).setOrigin(0);
    // 장식: 옅은 거미줄(모든 단계 고리 + 바큇살) — 실제로 이어진 줄은 그 위에 굵게
    const deco = this.add.graphics();
    deco.lineStyle(1, 0x2a2218, 1);
    for (let ring = 1; ring < L.radii.length; ring++) {
      const r = L.radii[ring] ?? 0;
      deco.strokePoints(
        DATA.branches.map((b) => ({ x: L.cx + Math.cos((b.angle * Math.PI) / 180) * r, y: L.cy + Math.sin((b.angle * Math.PI) / 180) * r })),
        true,
      );
    }
    for (const b of DATA.branches) {
      const a = (b.angle * Math.PI) / 180;
      deco.lineBetween(L.cx, L.cy, L.cx + Math.cos(a) * (L.labelRadius - 14), L.cy + Math.sin(a) * (L.labelRadius - 14));
      const name = b.id === 'sig' ? (DATA.signature[this.graph.archetype]?.name ?? b.name) : b.name;
      this.add
        .text(L.cx + Math.cos(a) * L.labelRadius, L.cy + Math.sin(a) * L.labelRadius, name, { ...uiText(13, b.color), stroke: '#0a0604', strokeThickness: 3 })
        .setOrigin(0.5);
    }
    this.linkGfx = this.add.graphics();
    this.nodeGfx = this.add.graphics();

    // 가운데: 캐릭터
    const c = this.add.graphics();
    c.fillStyle(0x2a2014, 1).fillCircle(L.cx, L.cy, 30).lineStyle(2, 0xffd34d, 1).strokeCircle(L.cx, L.cy, 30);
    // 발 기준점(50,92)·몸체 56~64px → 몸 가운데가 원 가운데에 오게
    if (isCharacterId(char)) this.add.image(L.cx, L.cy, manifest.sheetKey(char, 'move_slow'), 0).setOrigin(0.5, 0.61).setScale(0.85);

    for (const n of this.graph.nodes) {
      const p = this.pos.get(n.id);
      if (!p) continue;
      // 그림이 없는 아이콘(tp 등)은 행운 아이콘으로
      const key = [ICON[firstStat(n)], 'icon_upgrade_luck'].map((k) => manifest.image('ui', k ?? '', 32, 32).key).find((k) => this.textures.exists(k));
      if (key) this.icons.set(n.id, this.add.image(p.x, p.y, key).setScale(0.75));
      const zone = this.add.zone(p.x, p.y, 36, 36).setInteractive({ useHandCursor: true });
      zone.on('pointerover', () => this.select(n.id, false));
      zone.on('pointerdown', () => {
        this.select(n.id, false);
        this.tryUnlock();
      });
    }
    this.fxGfx = this.add.graphics();

    // 위: 이름·숙련
    const cd = (characters.characters as Record<string, { name: string }>)[char];
    this.add.text(16, 10, t('web.title', { name: cd?.name ?? char }), uiText(18, UI.hi));
    this.head = this.add.text(16, 36, '', uiText(12, UI.text));
    this.xpBar = this.add.graphics();
    const back = this.add.text(LOGICAL_WIDTH - 16, 12, t('web.back', { key: buttonLabel('uiBack') }), { ...uiText(12, UI.text), backgroundColor: '#2a2216', padding: { x: 8, y: 4 } });
    back.setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.leave());

    // 오른쪽: 칸 설명 + 지금 적용 중인 효과
    const px = 580;
    this.add.rectangle(px, 64, 364, 392, UI.bg, 0.92).setOrigin(0).setStrokeStyle(1, UI.border);
    this.title = this.add.text(px + 12, 74, '', { ...uiText(18, UI.hi), stroke: '#0a0604', strokeThickness: 3 });
    this.sub = this.add.text(px + 12, 102, '', uiText(12, UI.dim));
    this.body = this.add.text(px + 12, 126, '', { ...uiText(14, UI.text), lineSpacing: 4 });
    this.status = this.add.text(px + 12, 200, '', { ...uiText(13, UI.good), wordWrap: { width: 340 } });
    this.add.rectangle(px + 12, 238, 340, 1, UI.border).setOrigin(0);
    this.add.text(px + 12, 246, t('web.totalTitle'), uiText(13, UI.hi));
    this.total = this.add.text(px + 12, 268, '', { ...uiText(12, UI.text), lineSpacing: 3, wordWrap: { width: 340 } });
    this.message = this.add.text(px + 182, 470, '', { ...uiText(12, UI.hi), align: 'center', wordWrap: { width: 360 } }).setOrigin(0.5, 0);
    this.add
      .text(px + 182, 508, t('web.help', { ok: buttonLabel('uiConfirm'), reset: buttonLabel('webReset'), back: buttonLabel('uiBack') }), { ...uiText(11, UI.dim), align: 'center' })
      .setOrigin(0.5, 0);

    // 처음 커서: 열 수 있는 칸 중 고유 갈래 쪽부터
    const cw = this.charWeb();
    const owned = cw?.nodes ?? [];
    this.sel = this.graph.nodes.find((n) => !owned.includes(n.id) && isReachable(this.graph, owned, n.id))?.id ?? this.graph.nodes[0]?.id ?? '';
    this.refresh();
  }

  private charWeb(): CharWeb | undefined {
    return loadProfile().web?.[this.payload.char];
  }

  private select(id: string, sound = true): void {
    if (id === this.sel) return;
    this.sel = id;
    this.armedReset = false;
    if (sound) frontSfx(this, 'select');
    this.refresh();
  }

  private say(msg: string, color: string = UI.hi): void {
    this.message.setText(msg).setColor(color);
  }

  /** 방향키: 그 방향으로 가장 가까운 칸(옆으로 벗어난 거리는 두 배로 침) */
  private move(dx: number, dy: number): void {
    const cur = this.pos.get(this.sel);
    if (!cur) return;
    let best = '';
    let bestScore = Infinity;
    for (const [id, p] of this.pos) {
      if (id === this.sel) continue;
      const vx = p.x - cur.x;
      const vy = p.y - cur.y;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const score = along + Math.abs(vx * dy - vy * dx) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best) this.select(best);
  }

  private tryUnlock(): void {
    const n = this.graph.nodes.find((x) => x.id === this.sel);
    if (!n) return;
    const char = this.payload.char;
    const res = checkUnlock(this.graph, this.charWeb(), DATA.mastery, n.id);
    if (res === 'owned') return;
    if (res !== 'ok') {
      frontSfx(this, 'skill_denied');
      this.say(t(`web.why.${res}`, { n: n.cost }), UI.bad);
      return;
    }
    updateProfile((d) => {
      d.web = { ...(d.web ?? {}), [char]: unlockNode(this.graph, d.web?.[char], DATA.mastery, n.id) };
    });
    frontSfx(this, 'seal_stamp');
    const p = this.pos.get(n.id);
    const b = DATA.branches.find((x) => x.id === n.branch);
    if (p) this.bursts.push({ ...p, at: this.time.now, color: parseColor(b?.color ?? '#ffd34d') });
    this.say(t('web.opened', { name: n.name }), UI.good);
    this.refresh();
  }

  private reset(): void {
    const cw = this.charWeb();
    if (!cw || cw.nodes.length === 0) return;
    if (!this.armedReset) {
      this.armedReset = true;
      this.say(t('web.resetConfirm', { key: buttonLabel('webReset') }), UI.bad);
      return;
    }
    this.armedReset = false;
    updateProfile((d) => {
      d.web = { ...(d.web ?? {}), [this.payload.char]: resetWeb(d.web?.[this.payload.char]) };
    });
    frontSfx(this, 'card_deselect');
    this.say(t('web.resetDone'), UI.hi);
    this.refresh();
  }

  private leave(): void {
    const payload: PrepPayload = { stage: this.payload.stage };
    this.scene.start(SceneKey.Prep, payload);
  }

  /** 글자(머리·설명·합계)와 칸·줄 다시 그리기 */
  private refresh(): void {
    const cw = this.charWeb();
    const owned = cw?.nodes ?? [];
    const lv = masteryLevel(cw?.xp ?? 0, DATA.mastery);
    const pt = points(this.graph, cw, DATA.mastery);
    this.head.setText(
      t('web.head', { level: lv.level, xp: Math.round(lv.into), need: lv.need || '—', free: pt.free, total: pt.total }) + (lv.level === 0 ? `\n${t('web.howToEarn')}` : ''),
    );
    const bar = this.xpBar.clear();
    bar.fillStyle(0x2a2216, 1).fillRect(16, 54, 220, 4);
    bar.fillStyle(0x7fd8ff, 1).fillRect(16, 54, Math.round(220 * (lv.need ? lv.into / lv.need : 1)), 4);

    const n = this.graph.nodes.find((x) => x.id === this.sel);
    if (n) {
      const b = DATA.branches.find((x) => x.id === n.branch);
      const branch = n.branch === 'sig' ? (DATA.signature[this.graph.archetype]?.name ?? b?.name) : b?.name;
      this.title.setText(n.name).setColor(b?.color ?? UI.hi);
      this.sub.setText(t('web.sub', { branch: branch ?? '', ring: n.ring, cost: n.cost }));
      this.body.setText(effectLines(n).join('\n'));
      const res = checkUnlock(this.graph, cw, DATA.mastery, n.id);
      const color = res === 'ok' ? UI.good : res === 'owned' ? UI.hi : UI.bad;
      this.status.setText(res === 'ok' ? t('web.canOpen', { key: buttonLabel('uiConfirm') }) : t(`web.why.${res}`, { n: n.cost })).setColor(color);
    }
    const lines = summarize(webEffects(this.graph, owned)).map((s) => `${t(`web.stat.${s.stat}`)} ${formatMod(s.op, s.value, INVERSE.has(s.stat))}`);
    this.total.setText(lines.length > 0 ? lines.join(' · ') : t('web.totalNone'));
    this.drawWeb(owned, pt.free);
  }

  private drawWeb(owned: readonly string[], free: number): void {
    const lg = this.linkGfx.clear();
    const ownedSet = new Set(owned);
    const color = (id: string) => parseColor(DATA.branches.find((b) => b.id === this.graph.nodes.find((n) => n.id === id)?.branch)?.color ?? '#ffd34d');
    // 가운데 → 1단계, 그리고 실제 줄
    const segs: [{ x: number; y: number }, { x: number; y: number }, boolean, boolean, string][] = [];
    for (const n of this.graph.nodes) if (n.ring === 1) segs.push([{ x: L.cx, y: L.cy }, this.pos.get(n.id) ?? { x: 0, y: 0 }, true, ownedSet.has(n.id), n.id]);
    for (const [a, b] of this.graph.links) segs.push([this.pos.get(a) ?? { x: 0, y: 0 }, this.pos.get(b) ?? { x: 0, y: 0 }, ownedSet.has(a), ownedSet.has(b), ownedSet.has(a) ? b : a]);
    for (const [p, q, oa, ob, toward] of segs) {
      if (oa && ob) lg.lineStyle(3, 0xffd34d, 1);
      else if (oa || ob) lg.lineStyle(2, color(toward), 0.75);
      else lg.lineStyle(1, 0x4a4030, 1);
      lg.lineBetween(p.x, p.y, q.x, q.y);
    }
    const ng = this.nodeGfx.clear();
    for (const n of this.graph.nodes) {
      const p = this.pos.get(n.id);
      if (!p) continue;
      const r = NODE_R[n.ring] ?? 15;
      const col = color(n.id);
      const own = ownedSet.has(n.id);
      const reach = !own && isReachable(this.graph, owned, n.id);
      if (own) ng.fillStyle(col, 1).fillCircle(p.x, p.y, r).lineStyle(2, 0xfff4c0, 1).strokeCircle(p.x, p.y, r);
      else if (reach) ng.fillStyle(0x2a2418, 1).fillCircle(p.x, p.y, r).lineStyle(2, col, free >= n.cost ? 1 : 0.5).strokeCircle(p.x, p.y, r);
      else ng.fillStyle(0x18140f, 1).fillCircle(p.x, p.y, r).lineStyle(1, 0x4a4030, 1).strokeCircle(p.x, p.y, r);
      // 비용 2 칸은 바깥 고리 하나 더
      if (n.cost >= 2) ng.lineStyle(1, own ? 0xfff4c0 : 0x5a4a30, 0.8).strokeCircle(p.x, p.y, r + 3);
      this.icons.get(n.id)?.setAlpha(own ? 1 : reach ? 0.75 : 0.3);
    }
  }

  override update(time: number): void {
    const c = this.controls;
    if (c.justDown('uiBack')) {
      this.leave();
      c.endFrame();
      return;
    }
    if (c.justDown('uiLeft')) this.move(-1, 0);
    else if (c.justDown('uiRight')) this.move(1, 0);
    else if (c.justDown('uiUp')) this.move(0, -1);
    else if (c.justDown('uiDown')) this.move(0, 1);
    else if (c.justDown('uiConfirm')) this.tryUnlock();
    else if (c.justDown('webReset')) this.reset();
    c.endFrame();

    // 커서·열 수 있는 칸 반짝임·연 순간 퍼짐
    const fx = this.fxGfx.clear();
    const cw = this.charWeb();
    const owned = cw?.nodes ?? [];
    const free = points(this.graph, cw, DATA.mastery).free;
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    for (const n of this.graph.nodes) {
      const p = this.pos.get(n.id);
      if (!p || owned.includes(n.id) || free < n.cost || !isReachable(this.graph, owned, n.id)) continue;
      fx.lineStyle(2, 0xffd34d, 0.25 + 0.5 * pulse).strokeCircle(p.x, p.y, (NODE_R[n.ring] ?? 15) + 5 + pulse * 2);
    }
    const s = this.pos.get(this.sel);
    if (s) {
      const r = (NODE_R[this.graph.nodes.find((n) => n.id === this.sel)?.ring ?? 1] ?? 15) + 8;
      const a0 = time / 400;
      fx.lineStyle(2, 0xffffff, 1);
      for (let k = 0; k < 4; k++) {
        const a = a0 + (k * Math.PI) / 2;
        fx.beginPath().arc(s.x, s.y, r, a, a + 0.7).strokePath();
      }
    }
    this.bursts = this.bursts.filter((b) => time - b.at < 600);
    for (const b of this.bursts) {
      const k = (time - b.at) / 600;
      fx.lineStyle(3, b.color, 1 - k).strokeCircle(b.x, b.y, 16 + k * 40);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        fx.fillStyle(0xfff4c0, 1 - k).fillRect(Math.round(b.x + Math.cos(a) * (18 + k * 46)) - 1, Math.round(b.y + Math.sin(a) * (18 + k * 46)) - 1, 3, 3);
      }
    }
  }
}
