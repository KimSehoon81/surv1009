// 성장 지도(거미줄형 캐릭터 성장): 가운데 캐릭터에서 6갈래 × 5단계로 뻗은 칸을 숙련 포인트로 연다(skillWeb.json).
// v2(2026-11-15): 단계마다 숙련 레벨 관문, 옆 갈래를 잇는 연결 칸(양쪽 2단계가 모두 필요, 네모), 5단계 정점(마름모, 캐릭터당 개수 제한)
import * as Phaser from 'phaser';
import webJson from '../data/skillWeb.json';
import characters from '../data/characters.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { buildWeb, capstones, checkUnlock, formatMod, isReachable, isStale, masteryLevel, ownedNodes, points, resetWeb, summarize, unlockNode, webEffects, type CharWeb, type WebData, type WebGraph, type WebNode } from '../core/web';
import { parseColor } from '../core/feel';
import { manifest } from '../assets/manifest';
import { isCharacterId } from '../entities/Player';
import { InputMap } from '../systems/input';
import { loadProfile, updateProfile } from '../systems/save';
import { frontSfx, playMenuMusic } from '../systems/frontAudio';
import { uiText } from '../ui/text';
import { UI } from '../ui/widgets';
import { buttonLabel, hintVars } from '../ui/buttons';
import { t } from '../i18n';
import type { PrepPayload, WebPayload } from '../types/scenes';
import { SceneKey } from './keys';

interface Layout {
  cx: number;
  cy: number;
  radii: number[];
  labelRadius: number;
  /** 연결 칸(갈래 사이)의 반지름 */
  bridgeRadius: number;
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
/** 칸 반지름: 단계가 높을수록 조금 크게, 연결 칸은 13, 정점은 17 */
const nodeR = (n: WebNode | undefined): number => (!n ? 14 : n.kind === 'bridge' ? 13 : n.capstone ? 17 : 12 + Math.min(3, Math.floor(n.ring)));

/** 효과 한 줄들(칸 설명·합계 공용) */
function effectLines(n: WebNode): string[] {
  return summarize(webEffects({ nodes: [{ ...n, id: 'x' }], links: [], archetype: '', version: 0, capstoneLimit: 0 }, ['x'])).map(
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
  private reqs: Phaser.GameObjects.Text[] = [];
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
    const step = 360 / DATA.branches.length;
    for (const n of this.graph.nodes) {
      const b = DATA.branches.find((x) => x.id === n.branch);
      // 연결 칸은 이 갈래와 다음 갈래의 한가운데 각도
      const deg = (b?.angle ?? 0) + (n.kind === 'bridge' ? step / 2 : 0);
      const a = (deg * Math.PI) / 180;
      const r = n.kind === 'bridge' ? L.bridgeRadius : (L.radii[n.ring] ?? 0);
      this.pos.set(n.id, { x: Math.round(L.cx + Math.cos(a) * r), y: Math.round(L.cy + Math.sin(a) * r) });
    }
    // 규칙 판이 바뀌었으면 예전에 찍은 칸을 되돌리고 알림(포인트 환급, 경험치 유지)
    const stale = isStale(this.graph, loadProfile().web?.[char]);
    if (stale) {
      updateProfile((d) => {
        d.web = { ...(d.web ?? {}), [char]: resetWeb(this.graph, d.web?.[char]) };
      });
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
    c.fillStyle(0x2a2014, 1).fillCircle(L.cx, L.cy, 27).lineStyle(2, 0xffd34d, 1).strokeCircle(L.cx, L.cy, 27);
    // 발 기준점(50,92)·몸체 56~64px → 몸 가운데가 원 가운데에 오게
    if (isCharacterId(char)) {
      const fsz = manifest.sheet(char, 'move_slow').frameSize;
      this.add.image(L.cx, L.cy, manifest.sheetKey(char, 'move_slow'), 0).setOrigin(0.5, (fsz * manifest.anchor.y - 31) / fsz).setScale(0.75);
    }

    for (const n of this.graph.nodes) {
      const p = this.pos.get(n.id);
      if (!p) continue;
      // 그림이 없는 아이콘(tp 등)은 행운 아이콘으로
      const key = [ICON[firstStat(n)], 'icon_upgrade_luck'].map((k) => manifest.image('ui', k ?? '', 32, 32).key).find((k) => this.textures.exists(k));
      if (key) this.icons.set(n.id, this.add.image(p.x, p.y, key).setScale(n.capstone ? 0.75 : 0.625));
      const zone = this.add.zone(p.x, p.y, 32, 32).setInteractive({ useHandCursor: true });
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
    // 여는 조건(숙련 레벨·앞 칸·정점 제한): 안 채워진 줄은 붉게
    this.reqs = [0, 1, 2].map((i) => this.add.text(px + 12, 196 + i * 16, '', uiText(12, UI.dim)));
    this.status = this.add.text(px + 12, 248, '', { ...uiText(13, UI.good), wordWrap: { width: 340 } });
    this.add.rectangle(px + 12, 286, 340, 1, UI.border).setOrigin(0);
    this.add.text(px + 12, 294, t('web.totalTitle'), uiText(13, UI.hi));
    this.total = this.add.text(px + 12, 314, '', { ...uiText(12, UI.text), lineSpacing: 3, wordWrap: { width: 340 } });
    this.message = this.add.text(px + 182, 470, '', { ...uiText(12, UI.hi), align: 'center', wordWrap: { width: 360 } }).setOrigin(0.5, 0);
    this.add
      .text(px + 182, 508, t('web.help', { ...hintVars(), reset: buttonLabel('webReset') }), { ...uiText(11, UI.dim), align: 'center' })
      .setOrigin(0.5, 0);
    // 칸 모양 범례(오른쪽 판 맨 아래)
    this.add.text(px + 12, 436, t('web.legend', { max: this.graph.capstoneLimit }), uiText(11, UI.dim));

    // 처음 커서: 열 수 있는 칸 중 고유 갈래 쪽부터
    const cw = this.charWeb();
    const owned = ownedNodes(this.graph, cw);
    this.sel = this.graph.nodes.find((n) => !owned.includes(n.id) && isReachable(this.graph, owned, n.id))?.id ?? this.graph.nodes[0]?.id ?? '';
    this.refresh();
    if (stale) this.say(t('web.rulesChanged'), UI.hi);
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
      this.say(this.why(res, n), UI.bad);
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
    if (ownedNodes(this.graph, cw).length === 0) return;
    if (!this.armedReset) {
      this.armedReset = true;
      this.say(t('web.resetConfirm', { key: buttonLabel('webReset') }), UI.bad);
      return;
    }
    this.armedReset = false;
    updateProfile((d) => {
      d.web = { ...(d.web ?? {}), [this.payload.char]: resetWeb(this.graph, d.web?.[this.payload.char]) };
    });
    frontSfx(this, 'card_deselect');
    this.say(t('web.resetDone'), UI.hi);
    this.refresh();
  }

  private leave(): void {
    const payload: PrepPayload = { stage: this.payload.stage };
    this.scene.start(SceneKey.Prep, payload);
  }

  private branchName(id: string): string {
    const b = DATA.branches.find((x) => x.id === id);
    return (id === 'sig' ? DATA.signature[this.graph.archetype]?.name : undefined) ?? b?.name ?? '';
  }

  /** 못 여는 까닭 한 줄 */
  private why(res: string, n: WebNode): string {
    const now = masteryLevel(this.charWeb()?.xp ?? 0, DATA.mastery).level;
    return t(`web.why.${res}`, { n: n.cost, lv: n.level, now, max: this.graph.capstoneLimit });
  }

  /** 글자(머리·설명·합계)와 칸·줄 다시 그리기 */
  private refresh(): void {
    const cw = this.charWeb();
    const owned = ownedNodes(this.graph, cw);
    const lv = masteryLevel(cw?.xp ?? 0, DATA.mastery);
    const pt = points(this.graph, cw, DATA.mastery);
    const caps = capstones(this.graph, owned);
    this.head.setText(
      t('web.head', { level: lv.level, xp: Math.round(lv.into), need: lv.need || '—', free: pt.free, total: pt.total, caps, capMax: this.graph.capstoneLimit }) +
        (lv.level === 0 ? `\n${t('web.howToEarn')}` : ''),
    );
    const bar = this.xpBar.clear();
    bar.fillStyle(0x2a2216, 1).fillRect(16, 54, 220, 4);
    bar.fillStyle(0x7fd8ff, 1).fillRect(16, 54, Math.round(220 * (lv.need ? lv.into / lv.need : 1)), 4);

    const n = this.graph.nodes.find((x) => x.id === this.sel);
    if (n) {
      const b = DATA.branches.find((x) => x.id === n.branch);
      const branch = n.branch === 'sig' ? (DATA.signature[this.graph.archetype]?.name ?? b?.name) : b?.name;
      this.title.setText(n.name).setColor(b?.color ?? UI.hi);
      const other = n.kind === 'bridge' ? this.branchName(n.all?.[1]?.replace(/\d+$/, '') ?? '') : '';
      this.sub.setText(
        n.kind === 'bridge'
          ? t('web.subBridge', { a: branch ?? '', b: other, cost: n.cost })
          : t(n.capstone ? 'web.subCap' : 'web.sub', { branch: branch ?? '', ring: n.ring, cost: n.cost }),
      );
      this.body.setText(effectLines(n).join('\n'));
      const res = checkUnlock(this.graph, cw, DATA.mastery, n.id);
      const color = res === 'ok' ? UI.good : res === 'owned' ? UI.hi : UI.bad;
      this.status.setText(res === 'ok' ? t('web.canOpen', { key: buttonLabel('uiConfirm') }) : this.why(res, n)).setColor(color);
      // 조건 줄: 숙련 레벨 / 앞 칸 / 정점 제한(이미 연 칸이면 숨김)
      const own = owned.includes(n.id);
      const lines: [string, boolean][] = [];
      if (!own) {
        if (n.level > 0) lines.push([t('web.req.level', { lv: n.level, now: lv.level }), lv.level >= n.level]);
        if (n.all) lines.push([t('web.req.both', { a: branch ?? '', b: other }), isReachable(this.graph, owned, n.id)]);
        else if (n.ring > 1) lines.push([t('web.req.prev'), isReachable(this.graph, owned, n.id)]);
        if (n.capstone) lines.push([t('web.req.cap', { now: caps, max: this.graph.capstoneLimit }), caps < this.graph.capstoneLimit]);
      }
      this.reqs.forEach((tx, i) => {
        const l = lines[i];
        tx.setText(l ? `${l[1] ? '✓' : '✗'} ${l[0]}` : '').setColor(l?.[1] ? UI.good : UI.bad);
      });
    }
    const lines = summarize(webEffects(this.graph, owned)).map((s) => `${t(`web.stat.${s.stat}`)} ${formatMod(s.op, s.value, INVERSE.has(s.stat))}`);
    this.total.setText(lines.length > 0 ? lines.join(' · ') : t('web.totalNone'));
    this.drawWeb(owned, pt.free);
  }

  private drawWeb(owned: readonly string[], free: number): void {
    const lg = this.linkGfx.clear();
    const ownedSet = new Set(owned);
    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    const level = masteryLevel(this.charWeb()?.xp ?? 0, DATA.mastery).level;
    const color = (id: string) => parseColor(DATA.branches.find((b) => b.id === byId.get(id)?.branch)?.color ?? '#ffd34d');
    const at = (id: string) => this.pos.get(id) ?? { x: 0, y: 0 };
    // 가운데 → 1단계, 갈래·고리 줄, 연결 칸으로 가는 두 줄(둘 다 있어야 하므로 점선)
    const segs: [{ x: number; y: number }, { x: number; y: number }, boolean, boolean, string, boolean][] = [];
    for (const n of this.graph.nodes) if (n.ring === 1) segs.push([{ x: L.cx, y: L.cy }, at(n.id), true, ownedSet.has(n.id), n.id, false]);
    for (const [a, b] of this.graph.links) segs.push([at(a), at(b), ownedSet.has(a), ownedSet.has(b), ownedSet.has(a) ? b : a, false]);
    for (const n of this.graph.nodes) for (const need of n.all ?? []) segs.push([at(need), at(n.id), ownedSet.has(need), ownedSet.has(n.id), n.id, true]);
    for (const [p, q, oa, ob, toward, dashed] of segs) {
      const w = oa && ob ? 3 : oa || ob ? 2 : 1;
      const c = oa && ob ? 0xffd34d : oa || ob ? color(toward) : 0x4a4030;
      lg.lineStyle(w, c, oa && ob ? 1 : oa || ob ? 0.75 : 1);
      if (!dashed) {
        lg.lineBetween(p.x, p.y, q.x, q.y);
        continue;
      }
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      for (let d = 0; d < len; d += 7) {
        const e = Math.min(len, d + 4);
        lg.lineBetween(p.x + ((q.x - p.x) * d) / len, p.y + ((q.y - p.y) * d) / len, p.x + ((q.x - p.x) * e) / len, p.y + ((q.y - p.y) * e) / len);
      }
    }
    const ng = this.nodeGfx.clear();
    for (const n of this.graph.nodes) {
      const p = this.pos.get(n.id);
      if (!p) continue;
      const r = nodeR(n);
      const col = color(n.id);
      const own = ownedSet.has(n.id);
      const reach = !own && isReachable(this.graph, owned, n.id);
      // 관문(숙련 레벨)에 막힌 칸은 이어져 있어도 어둡게
      const gated = level < n.level;
      const open = reach && !gated;
      const fill = own ? col : open ? 0x2a2418 : 0x18140f;
      const line = own ? 0xfff4c0 : open ? col : 0x4a4030;
      const lw = own || open ? 2 : 1;
      const la = open && free < n.cost ? 0.5 : 1;
      ng.fillStyle(fill, 1).lineStyle(lw, line, la);
      if (n.kind === 'bridge') {
        // 연결 칸: 네모
        ng.fillRect(p.x - r, p.y - r, r * 2, r * 2).strokeRect(p.x - r, p.y - r, r * 2, r * 2);
      } else if (n.capstone) {
        // 정점: 마름모 + 바깥 테
        const pts = [{ x: p.x, y: p.y - r - 3 }, { x: p.x + r + 3, y: p.y }, { x: p.x, y: p.y + r + 3 }, { x: p.x - r - 3, y: p.y }];
        ng.fillPoints(pts, true).strokePoints(pts, true);
        ng.lineStyle(1, own ? 0xffd34d : 0x6a5a30, 0.9).strokeCircle(p.x, p.y, r + 7);
      } else ng.fillCircle(p.x, p.y, r).strokeCircle(p.x, p.y, r);
      this.icons.get(n.id)?.setAlpha(own ? 1 : open ? 0.8 : 0.28);
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
    const pulse = 0.5 + 0.5 * Math.sin(time / 180);
    // 지금 바로 열 수 있는 칸(이어짐·관문·포인트 모두 통과)만 반짝임
    for (const n of this.graph.nodes) {
      const p = this.pos.get(n.id);
      if (!p || checkUnlock(this.graph, cw, DATA.mastery, n.id) !== 'ok') continue;
      fx.lineStyle(2, 0xffd34d, 0.25 + 0.5 * pulse).strokeCircle(p.x, p.y, nodeR(n) + 5 + pulse * 2);
    }
    const s = this.pos.get(this.sel);
    if (s) {
      const r = nodeR(this.graph.nodes.find((n) => n.id === this.sel)) + 9;
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
