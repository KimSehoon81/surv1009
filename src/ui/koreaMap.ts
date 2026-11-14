// 작은 한반도 지도(미션 클리어 화면): 바다·땅·강·38선·지역 점, 방금 점령한 곳 → 다음 목표로 흐르는 진격 화살표
import type * as Phaser from 'phaser';
import mapData from '../data/map.json';
import { project, type LonLat, type Projection } from '../core/geo';
import { uiText } from './text';
import { t } from '../i18n';

export interface MiniMap {
  /** 매 프레임(다음 목표 깜박임·진격 화살표 흐름) */
  update(time: number): void;
}

/** (x, y) = 지도 칸 왼쪽 위, scale = 위도 1°당 px. captured = 점령한 지역, current = 방금 끝난 지역, next = 다음 목표 */
export function drawMiniMap(
  scene: Phaser.Scene,
  root: Phaser.GameObjects.Container,
  opts: { x: number; y: number; scale: number },
  state: { captured: ReadonlySet<string>; current: string; next: string | null },
): MiniMap {
  const P: Projection = { lon0: 123.6, lat0: 43.3, scale: opts.scale, x0: opts.x, y0: opts.y };
  const pr = (lon: number, lat: number) => project(P, lon, lat);
  const br = pr(131.0, 33.0);
  const g = scene.add.graphics();
  root.add(g);
  // 바다 칸 + 테두리
  g.fillStyle(0x14212b, 1).fillRect(opts.x - 6, opts.y - 6, br.x - opts.x + 12, br.y - opts.y + 12);
  g.lineStyle(2, 0xc8b078, 1).strokeRect(opts.x - 6, opts.y - 6, br.x - opts.x + 12, br.y - opts.y + 12);
  const poly = (pts: readonly LonLat[]) => pts.map(([lon, lat]) => pr(lon, lat));
  g.fillStyle(0x3a3a30, 1).fillPoints(poly(mapData.mainland as unknown as LonLat[]).map((p) => ({ x: Math.max(opts.x - 6, p.x), y: Math.max(opts.y - 6, p.y) })), true);
  const land = poly(mapData.coast as unknown as LonLat[]);
  g.fillStyle(0x9c8558, 1).fillPoints(land, true);
  g.fillStyle(0x9c8558, 1).fillPoints(poly(mapData.jeju as unknown as LonLat[]), true);
  g.lineStyle(1, 0x3a2a16, 1).strokePoints(land, true);
  for (const r of Object.values(mapData.rivers as unknown as Record<string, LonLat[]>)) g.lineStyle(1, 0x4a7a9a, 1).strokePoints(poly(r), false);
  const y38 = pr(124, mapData.parallel38).y;
  for (let x = pr(124.6, 0).x; x < pr(129.4, 0).x; x += 6) g.fillStyle(0xd84a3a, 1).fillRect(x, y38, 3, 1);
  const nodes = mapData.nodes.map((n) => ({ id: n.id, ...pr(n.lon, n.lat) }));
  // 지나온 진격로(점령한 곳끼리 파랑 실선)
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (a && b && state.captured.has(a.id) && state.captured.has(b.id)) g.lineStyle(2, 0x3a7bd5, 0.9).lineBetween(a.x, a.y, b.x, b.y);
  }
  for (const n of nodes) {
    const cap = state.captured.has(n.id);
    g.fillStyle(cap ? 0x3a7bd5 : 0x4a4a4a, 1).fillCircle(n.x, n.y, cap ? 4 : 3);
    g.lineStyle(1, 0x1a1410, 1).strokeCircle(n.x, n.y, cap ? 4 : 3);
  }
  const cur = nodes.find((n) => n.id === state.current);
  const nxt = state.next ? nodes.find((n) => n.id === state.next) : undefined;
  if (nxt) {
    const lab = scene.add.text(nxt.x + 9, nxt.y, t('hud.result.nextShort'), { ...uiText(11, '#ffd34d'), stroke: '#0a0604', strokeThickness: 3 }).setOrigin(0, 0.5);
    root.add(lab);
  }
  const fx = scene.add.graphics();
  root.add(fx);
  return {
    update(time: number) {
      fx.clear();
      if (cur) {
        // 방금 점령: 흰 별 + 퍼지는 고리
        const k = (time % 1200) / 1200;
        fx.lineStyle(2, 0x7fd8ff, 1 - k).strokeCircle(cur.x, cur.y, 5 + k * 12);
        fx.fillStyle(0xffffff, 1).fillCircle(cur.x, cur.y, 2);
      }
      if (!cur || !nxt) return;
      // 진격 화살표: 점이 흐르고 끝에 화살촉
      const len = Math.hypot(nxt.x - cur.x, nxt.y - cur.y) || 1;
      const ux = (nxt.x - cur.x) / len;
      const uy = (nxt.y - cur.y) / len;
      const off = (time / 30) % 8;
      for (let d = off; d < len - 8; d += 8) fx.fillStyle(0xffd34d, 0.95).fillRect(cur.x + ux * d - 1, cur.y + uy * d - 1, 3, 3);
      const hx = nxt.x - ux * 8;
      const hy = nxt.y - uy * 8;
      fx.fillStyle(0xffd34d, 1).fillTriangle(nxt.x - ux * 3, nxt.y - uy * 3, hx - uy * 5, hy + ux * 5, hx + uy * 5, hy - ux * 5);
      const pulse = 0.5 + 0.5 * Math.sin(time / 160);
      fx.lineStyle(2, 0xffd34d, 0.5 + 0.5 * pulse).strokeCircle(nxt.x, nxt.y, 7 + pulse * 3);
    },
  };
}
