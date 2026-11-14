import * as Phaser from 'phaser';
import mapData from '../data/map.json';
import stagesData from '../data/stages.json';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { isUnlocked } from '../core/save';
import { InputMap } from '../systems/input';
import { loadProfile } from '../systems/save';
import { uiText } from '../ui/text';
import type { MapPayload, PrepPayload } from '../types/scenes';
import { SceneKey } from './keys';
import { t } from '../i18n';
import { params } from '../config/params';
import { inside, project, type LonLat, type Projection } from '../core/geo';
import { playMenuMusic } from '../systems/frontAudio';

const PROJ = mapData.projection as Projection;
const pr = (lon: number, lat: number) => project(PROJ, lon, lat);
/** 지역 노드(실제 도시 위치를 투영). 라벨은 바다 쪽(서해안 노드는 왼쪽) */
const NODES = mapData.nodes.map((n) => ({ ...n, ...pr(n.lon, n.lat), left: n.lon < 126.8 && n.lat < 38 }));
const ORDER = NODES.map((n) => n.id);
const ALLY = 0x3a7bd5;
const COAST = mapData.coast as unknown as LonLat[];

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
    this.drawTerrain();
    playMenuMusic(this);
    this.gfx = this.add.graphics();
    this.add.text(16, 12, t('map.title'), uiText(18, '#ffe14d'));
    this.add.text(16, 36, t('map.merit', { n: prof.merit }), uiText(12));
    // 캠페인 목적 한눈에: 어디서 어디까지, 한 판의 흐름, 점령 보상
    this.add.text(16, 72, t('map.goal'), { ...uiText(12, '#e8dcc0'), wordWrap: { width: 290 }, lineSpacing: 6 });
    this.add.text(16, LOGICAL_HEIGHT - 24, t('map.help'), uiText(12, '#b0a890'));
    this.info = this.add.text(650, 90, '', { ...uiText(13), lineSpacing: 6, wordWrap: { width: 290 } });
    this.notice = this.add.text(LOGICAL_WIDTH / 2, 70, '', { ...uiText(15, '#ffe14d'), backgroundColor: '#000000b0', padding: { x: 10, y: 5 } }).setOrigin(0.5).setVisible(false);

    NODES.forEach((n, i) => {
      const hit = this.add.circle(n.x, n.y, 16, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      // 지역 라벨(번호 + 도): 바다 쪽으로
      this.add
        .text(n.left ? n.x - 13 : n.x + 13, n.y, `${i + 1} ${n.region}`, { ...uiText(11, '#f4ecd8'), stroke: '#1a1208', strokeThickness: 3 })
        .setOrigin(n.left ? 1 : 0, 0.5);
      hit.on('pointerdown', () => {
        if (this.sel === i) this.confirm();
        this.sel = i;
      });
    });
    const focus = this.payload.focus ? ORDER.indexOf(this.payload.focus) : -1;
    // 처음엔 아직 점령하지 않은 첫 열린 지역
    this.sel = focus >= 0 ? focus : Math.max(0, ORDER.findIndex((id) => isUnlocked(prof, ORDER, id) && !prof.stages[id]?.captured));
    const r = this.payload.lastResult;
    if (r) {
      const name = (stagesData.stages as Record<string, { name: string }>)[r.stage]?.name ?? r.stage;
      this.say(t(r.victory ? 'map.returnWin' : 'map.returnLose', { name, n: r.merit }));
    }
    // 자동 진행(D44): 지정 스테이지를 골라 출정 준비로
    const auto = params.auto;
    if (auto && !r) {
      this.sel = Math.max(0, ORDER.indexOf(auto));
      this.time.delayedCall(300, () => this.confirm());
    }
  }

  /** 옛 군용 지도: 물결 무늬 바다·경위도 격자·만주(흐리게)·한반도(그림자·점묘)·강·산맥·38선·바다 이름 */
  private drawTerrain(): void {
    const W = LOGICAL_WIDTH;
    const H = LOGICAL_HEIGHT;
    this.add.rectangle(0, 0, W, H, 0x14212b).setOrigin(0);
    const g = this.add.graphics();
    for (let y = 6; y < H; y += 9) for (let x = (y * 7) % 23; x < W; x += 23) g.fillStyle(0x1b2c38, 1).fillRect(x, y, 7, 1);
    // 경위도 격자(1°)와 눈금
    const left = pr(124.1, 0).x;
    const right = pr(131.3, 0).x;
    for (let lat = 34; lat <= 43; lat++) {
      const y = pr(124, lat).y;
      for (let x = left; x < right; x += 6) g.fillStyle(0x2a4050, 1).fillRect(x, y, 3, 1);
      this.add.text(pr(123.08, 0).x, y - 1, `${lat}°`, uiText(11, '#4f6a7c')).setOrigin(0, 1);
    }
    for (let lon = 125; lon <= 131; lon++) {
      const x = pr(lon, 0).x;
      for (let y = 8; y < 512; y += 6) g.fillStyle(0x2a4050, 1).fillRect(x, y, 1, 3);
    }
    const poly = (pts: readonly LonLat[]) => pts.map(([lon, lat]) => pr(lon, lat));
    // 만주·연해주(대륙, 흐리게)
    g.fillStyle(0x3a3a30, 1).fillPoints(poly(mapData.mainland as unknown as LonLat[]), true);
    // 한반도: 그림자 → 땅 → 해안선
    const land = poly(COAST);
    g.fillStyle(0x0c141a, 1).fillPoints(land.map((p) => ({ x: p.x + 3, y: p.y + 4 })), true);
    g.fillStyle(0x9c8558, 1).fillPoints(land, true);
    g.fillStyle(0x9c8558, 1).fillPoints(poly(mapData.jeju as unknown as LonLat[]), true);
    // 지형 점묘(땅 안에만, 결정적 무늬)
    for (let i = 0; i < 900; i++) {
      const lon = 124.3 + ((i * 0.6180339) % 1) * 6.4;
      const lat = 34.3 + ((i * 0.4142135) % 1) * 8.7;
      if (!inside(COAST, lon, lat)) continue;
      const p = pr(lon, lat);
      g.fillStyle(i % 3 ? 0x8a7449 : 0xae9666, 1).fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    g.lineStyle(2, 0x3a2a16, 1).strokePoints(land, true);
    // 압록강·두만강 국경(강 색)
    g.lineStyle(2, 0x4a7a9a, 1).strokePoints(land.slice(0, 16), false);
    // 강
    for (const r of Object.values(mapData.rivers as unknown as Record<string, LonLat[]>)) g.lineStyle(2, 0x4a7a9a, 1).strokePoints(poly(r), false);
    // 산맥 ^
    for (const [lon, lat] of mapData.mountains as unknown as LonLat[]) {
      const p = pr(lon, lat);
      g.lineStyle(1, 0x5a4428, 1).lineBetween(p.x - 4, p.y + 3, p.x, p.y - 2).lineBetween(p.x, p.y - 2, p.x + 4, p.y + 3);
    }
    // 38선: 붉은 점선 + 라벨
    const y38 = pr(124, mapData.parallel38).y;
    const xa = pr(124.6, 0).x;
    const xb = pr(129.4, 0).x;
    for (let x = xa; x < xb; x += 8) g.fillStyle(0xd84a3a, 1).fillRect(x, y38, 5, 2);
    this.add.text(xb + 4, y38, t('map.parallel'), { ...uiText(12, '#ff7a60'), stroke: '#1a0a08', strokeThickness: 3 }).setOrigin(0, 0.5);
    // 바다·대륙 이름
    const label = (key: string, lon: number, lat: number, color: string) => {
      const p = pr(lon, lat);
      this.add.text(p.x, p.y, t(key), uiText(12, color)).setOrigin(0.5);
    };
    label('map.sea.east', 130.4, 38.5, '#5d7f96');
    label('map.sea.west', 124.6, 36.4, '#5d7f96');
    label('map.land.manchuria', 126.6, 42.6, '#7a7a66');
    // 지도 칸 이중 테두리(옛 지도처럼, 대륙이 잘린 가장자리를 테두리로)
    const tl = pr(123.0, 43.6);
    const br = pr(131.45, 33.0);
    g.lineStyle(2, 0xc8b078, 1).strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    g.lineStyle(1, 0x6a5a3a, 1).strokeRect(tl.x - 4, tl.y - 4, br.x - tl.x + 8, br.y - tl.y + 8);
    // 나침반(북)
    const nx = pr(130.9, 0).x;
    const ny = pr(0, 34.6).y;
    g.fillStyle(0xd8c890, 1).fillTriangle(nx, ny - 16, nx - 5, ny, nx + 5, ny);
    this.add.text(nx, ny + 9, 'N', uiText(12, '#d8c890')).setOrigin(0.5);
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
    // 진격로(남→북): 점령한 구간은 아군 파랑 실선, 다음 목표 구간은 흐르는 금색 점선, 나머지는 흐린 점선
    for (let i = 1; i < NODES.length; i++) {
      const a = NODES[i - 1];
      const b = NODES[i];
      if (!a || !b) continue;
      const done = prof.stages[b.id]?.captured === true;
      const next = !done && prof.stages[a.id]?.captured === true;
      if (done) {
        g.lineStyle(3, ALLY, 0.9).lineBetween(a.x, a.y, b.x, b.y);
        continue;
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const off = next ? (time / 40) % 10 : 0;
      for (let d = off; d < len; d += 10) {
        const k = d / len;
        g.fillStyle(next ? 0xffd84a : 0xe8dcc0, next ? 0.95 : 0.3).fillRect(a.x + (b.x - a.x) * k - 1, a.y + (b.y - a.y) * k - 1, 3, 3);
      }
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
      // 점령: 흰 별(색 말고 형태로도 구분)
      if (cap) {
        const pts: { x: number; y: number }[] = [];
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const r = k % 2 ? 2.2 : 5.5;
          pts.push({ x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r });
        }
        g.fillStyle(0xffffff, 1).fillPoints(pts, true);
      }
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
