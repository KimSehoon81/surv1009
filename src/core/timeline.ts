// 연출 타임라인(PRD §6.2·§6.4 v0.2 데이터 3층의 1층: 언제·어디). Phaser 없음.
// 정의(timelines.json)를 시전 순간의 조준점·플레이어 위치로 펼쳐 "몇 ms에 어디서 어떤 큐"의 목록을 만들고,
// TimelinePlayer가 전투 시계 시각을 받아 도달한 것만 내보낸다(일시정지·슬로모·히트스톱은 시계가 처리).

export interface Point {
  x: number;
  y: number;
}

export interface RepeatDef {
  count: number;
  /** 발 사이 간격(초) */
  every: number;
  pattern?: 'line' | 'fan' | 'scatter';
  /** line: 한 발마다 [dx, dy] px(가운데 정렬) */
  step?: readonly number[];
  /** fan: 부채꼴 전체 각도 */
  spreadDeg?: number;
  /** fan: 흔들림 / scatter: 흩어질 반경 px */
  radius?: number;
  /** 마지막 1발만 다른 큐(히트스톱은 마지막에만) */
  lastCue?: string;
}

export interface TimelineEventDef {
  t: number;
  cue: string;
  at?: 'aim' | 'player';
  offset?: readonly number[];
  damage?: number;
  radius?: number;
  /** 착탄 몇 초 전부터 예고 마커 */
  markerLead?: number;
  repeat?: RepeatDef;
}

export interface TimelineDef {
  events: readonly TimelineEventDef[];
}

/** 펼쳐진 이벤트 하나. cue가 MARKER_CUE면 예고 마커(durationMs 동안) */
export interface FiredEvent {
  atMs: number;
  cue: string;
  x: number;
  y: number;
  damage: number;
  radius: number;
  durationMs: number;
  /** 반복 안에서 몇 번째(0부터)와 전체 수 */
  index: number;
  count: number;
}

export const MARKER_CUE = 'marker';

export interface ExpandOrigin {
  aim: Point;
  player: Point;
  /** fan 최소 거리(조준점이 플레이어에 너무 가까울 때) */
  minFanDist?: number;
}

function placeAt(ev: TimelineEventDef, i: number, n: number, o: ExpandOrigin, rand: () => number): Point {
  const base = ev.at === 'player' ? o.player : o.aim;
  const [ox = 0, oy = 0] = ev.offset ?? [];
  const p = { x: base.x + ox, y: base.y + oy };
  const r = ev.repeat;
  if (!r || n <= 1) return p;
  if (r.pattern === 'line') {
    const [sx = 0, sy = 0] = r.step ?? [];
    const k = i - (n - 1) / 2;
    return { x: p.x + sx * k, y: p.y + sy * k };
  }
  if (r.pattern === 'fan') {
    const dx = p.x - o.player.x;
    const dy = p.y - o.player.y;
    const dist = Math.max(o.minFanDist ?? 0, Math.hypot(dx, dy));
    const base = dx === 0 && dy === 0 ? 0 : Math.atan2(dy, dx);
    const a = base + ((r.spreadDeg ?? 60) * Math.PI) / 180 * (i / (n - 1) - 0.5);
    const j = r.radius ?? 0;
    return { x: o.player.x + Math.cos(a) * dist + (rand() - 0.5) * 2 * j, y: o.player.y + Math.sin(a) * dist + (rand() - 0.5) * 2 * j };
  }
  if (r.pattern === 'scatter') {
    const d = Math.sqrt(rand()) * (r.radius ?? 0);
    const a = rand() * Math.PI * 2;
    return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
  }
  return p;
}

/** 정의 → 시각순 이벤트 목록(같은 시각이면 정의 순서). 예고 마커는 착탄과 같은 위치로 함께 펼친다 */
export function expandTimeline(def: TimelineDef, origin: ExpandOrigin, rand: () => number): FiredEvent[] {
  const out: (FiredEvent & { order: number })[] = [];
  let order = 0;
  for (const ev of def.events) {
    const n = Math.max(1, ev.repeat?.count ?? 1);
    for (let i = 0; i < n; i++) {
      const atMs = Math.round((ev.t + i * (ev.repeat?.every ?? 0)) * 1000);
      const at = placeAt(ev, i, n, origin, rand);
      const cue = i === n - 1 && n > 1 && ev.repeat?.lastCue ? ev.repeat.lastCue : ev.cue;
      const radius = ev.radius ?? 0;
      if (ev.markerLead && ev.markerLead > 0) {
        const lead = Math.round(ev.markerLead * 1000);
        out.push({ atMs: Math.max(0, atMs - lead), cue: MARKER_CUE, x: at.x, y: at.y, damage: 0, radius, durationMs: Math.min(lead, atMs), index: i, count: n, order: order++ });
      }
      out.push({ atMs, cue, x: at.x, y: at.y, damage: ev.damage ?? 0, radius, durationMs: 0, index: i, count: n, order: order++ });
    }
  }
  out.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
  return out.map(({ order: _o, ...e }) => e);
}

/** 펼친 목록을 시각에 맞춰 내보낸다 */
export class TimelinePlayer {
  private next = 0;

  constructor(
    readonly events: readonly FiredEvent[],
    readonly startMs: number,
  ) {}

  /** nowMs(전투 시계)까지 도달한 이벤트(처음 한 번만) */
  due(nowMs: number): FiredEvent[] {
    const out: FiredEvent[] = [];
    while (this.next < this.events.length) {
      const e = this.events[this.next] as FiredEvent;
      if (this.startMs + e.atMs > nowMs) break;
      out.push(e);
      this.next++;
    }
    return out;
  }

  get done(): boolean {
    return this.next >= this.events.length;
  }

  /** 끝까지 걸리는 시간 */
  get durationMs(): number {
    return this.events.reduce((m, e) => Math.max(m, e.atMs + e.durationMs), 0);
  }
}
