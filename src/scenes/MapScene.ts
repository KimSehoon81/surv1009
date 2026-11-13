import * as Phaser from 'phaser';
import mapData from '../data/map.json';
import stagesData from '../data/stages.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { isUnlocked } from '../core/save';
import { manifest } from '../assets/manifest';
import { InputMap } from '../systems/input';
import { loadProfile } from '../systems/save';
import { uiText } from '../ui/text';
import type { MapPayload, PrepPayload } from '../types/scenes';
import { SceneKey } from './keys';
import { t } from '../i18n';

const NODES = mapData.nodes;
const ORDER = NODES.map((n) => n.id);
const ALLY = 0x3a7bd5;

/**
 * 한반도 작전지도(PRD §7.2): 10개 지역 남→북, 미해금 안개, 점령 지역 아군 색 + 깃발.
 * 지도 그림이 없으면 단순 다각형 실루엣. 좌우(또는 위아래)·클릭으로 고르고 Enter로 출정 준비.
 */
export class MapScene extends Phaser.Scene {
  private controls!: InputMap;
  private payload: MapPayload = {};
  private sel = 0;
  private gfx!: Phaser.GameObjects.Graphics;
  private info!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private noticeUntil = 0;

  constructor() {
    super(SceneKey.Map);
  }

  init(data: MapPayload): void {
    this.payload = data ?? {};
  }

  create(): void {
    this.controls = new InputMap(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.controls.destroy());
    const prof = loadProfile();
    // 바다 + 땅(자리표시자 실루엣)
    this.add.rectangle(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT, 0x1c2a36).setOrigin(0);
    const land = this.add.graphics();
    const pts = mapData.outline.map(([x = 0, y = 0]) => new Phaser.Math.Vector2(x, y));
    land.fillStyle(0x6b5a3e, 1).fillPoints(pts, true).lineStyle(2, 0x2a2016, 1).strokePoints(pts, true);
    this.gfx = this.add.graphics();
    this.add.text(16, 12, t('map.title'), uiText(18, '#ffe14d'));
    this.add.text(16, 36, t('map.merit', { n: prof.merit }), uiText(12));
    this.add.text(16, LOGICAL_HEIGHT - 24, t('map.help'), uiText(12, '#b0a890'));
    this.info = this.add.text(650, 90, '', { ...uiText(13), lineSpacing: 6, wordWrap: { width: 290 } });
    this.notice = this.add.text(LOGICAL_WIDTH / 2, 70, '', { ...uiText(15, '#ffe14d'), backgroundColor: '#000000b0', padding: { x: 10, y: 5 } }).setOrigin(0.5).setVisible(false);

    NODES.forEach((n, i) => {
      const hit = this.add.circle(n.x, n.y, 16, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => {
        if (this.sel === i) this.confirm();
        this.sel = i;
      });
      if (prof.stages[n.id]?.captured) this.add.image(n.x + 6, n.y - 4, manifest.image('ui', 'flag_ally', 32, 32).key).setOrigin(0.2, 1).setScale(1);
    });
    const focus = this.payload.focus ? ORDER.indexOf(this.payload.focus) : -1;
    // 처음엔 아직 점령하지 않은 첫 열린 지역
    this.sel = focus >= 0 ? focus : Math.max(0, ORDER.findIndex((id) => isUnlocked(prof, ORDER, id) && !prof.stages[id]?.captured));
    const r = this.payload.lastResult;
    if (r) {
      const name = (stagesData.stages as Record<string, { name: string }>)[r.stage]?.name ?? r.stage;
      this.say(t(r.victory ? 'map.returnWin' : 'map.returnLose', { name, n: r.merit }));
    }
  }

  private say(msg: string): void {
    this.notice.setText(msg).setVisible(true);
    this.noticeUntil = this.time.now + 2500;
  }

  private confirm(): void {
    const prof = loadProfile();
    const n = NODES[this.sel];
    if (!n) return;
    if (!isUnlocked(prof, ORDER, n.id)) {
      this.say(t('map.needPrev'));
      return;
    }
    if (!(n.id in stagesData.stages)) {
      this.say(t('map.notReady', { region: n.region }));
      return;
    }
    const payload: PrepPayload = { stage: n.id };
    this.scene.start(SceneKey.Prep, payload);
  }

  override update(time: number): void {
    const c = this.controls;
    if (c.justDown('uiNext')) this.sel = (this.sel + 1) % NODES.length;
    if (c.justDown('uiPrev')) this.sel = (this.sel + NODES.length - 1) % NODES.length;
    if (c.justDown('uiConfirm')) this.confirm();
    if (c.justDown('uiBack')) this.scene.start(SceneKey.Menu);
    c.endFrame();
    if (this.notice.visible && this.time.now > this.noticeUntil) this.notice.setVisible(false);
    this.draw(time);
  }

  private draw(time: number): void {
    const prof = loadProfile();
    const g = this.gfx.clear();
    // 진격로(남→북)
    for (let i = 1; i < NODES.length; i++) {
      const a = NODES[i - 1];
      const b = NODES[i];
      if (a && b) g.lineStyle(1, 0xe8dcc0, 0.35).lineBetween(a.x, a.y, b.x, b.y);
    }
    NODES.forEach((n, i) => {
      const open = isUnlocked(prof, ORDER, n.id);
      const cap = prof.stages[n.id]?.captured === true;
      if (!open) {
        // 안개: 흐린 회색 덩어리
        g.fillStyle(0x9aa0a6, 0.45).fillCircle(n.x, n.y, 22).fillCircle(n.x - 10, n.y + 6, 14).fillCircle(n.x + 12, n.y + 4, 13);
      }
      g.fillStyle(cap ? ALLY : open ? 0xd8b850 : 0x4a4a4a, 1).fillCircle(n.x, n.y, 8);
      g.lineStyle(2, 0x1a1410, 1).strokeCircle(n.x, n.y, 8);
      if (i === this.sel) g.lineStyle(2, 0xffe14d, 0.6 + 0.4 * Math.abs(Math.sin(time / 250))).strokeCircle(n.x, n.y, 15);
    });
    const n = NODES[this.sel];
    if (!n) return;
    const rec = prof.stages[n.id];
    const open = isUnlocked(prof, ORDER, n.id);
    const ready = n.id in stagesData.stages;
    const status = !open ? t('map.st.fog') : rec?.captured ? `${t('map.st.captured', { n: rec.clears })}${rec.bestTimeSec ? t('map.st.best', { time: `${Math.floor(rec.bestTimeSec / 60)}:${String(rec.bestTimeSec % 60).padStart(2, '0')}` }) : ''}` : ready ? t('map.st.open') : t('map.st.notReady');
    this.info.setText(
      [`${ORDER.indexOf(n.id) + 1}. ${n.region} — ${n.name}`, '', t('map.info', { enemies: n.enemies, boss: n.boss, disruption: n.disruption }), '', t('map.status', { status })].join('\n'),
    );
  }
}
