// 방해 관리자(PRD §5.4 v0.2): 동시 최대 2개, 카드를 가리는 방해(분류 a)는 1개. 상태만 두고 표현은 HUD가 읽는다.
// source = 방해를 건 쪽(stage·적 ID·NPC). 적이 건 방해(G6, D22)는 sources(적 개체 ID)를 모으고,
// 원인 적이 모두 죽으면 풀린다(시간 제한 없음). 이후 방해원 적도 같은 규칙을 쓴다.

export interface ActiveDisruption {
  type: string;
  category: string;
  source: string;
  priority: number;
  untilSec: number;
  /** 원인 적 개체 ID(비면 시간제 방해). 모두 처치되면 해제 */
  sources?: string[];
}

export class Disruptions {
  active: ActiveDisruption[] = [];

  constructor(
    private readonly max: number,
    private readonly maxCardObscuring: number,
  ) {}

  /**
   * 걸기. 같은 종류가 이미 있으면 시간만 늘린다. 자리가 없으면 우선순위가 더 낮은 것을 밀어내고, 없으면 거절(false).
   */
  add(d: { type: string; category: string; source: string; priority: number; durationSec: number }, nowSec: number): boolean {
    const same = this.active.find((a) => a.type === d.type);
    if (same) {
      same.untilSec = Math.max(same.untilSec, nowSec + d.durationSec);
      return true;
    }
    const entry: ActiveDisruption = { type: d.type, category: d.category, source: d.source, priority: d.priority, untilSec: nowSec + d.durationSec };
    const sameCat = d.category === 'a' ? this.active.filter((a) => a.category === 'a') : [];
    if (sameCat.length >= this.maxCardObscuring) return this.replaceLower(sameCat, entry);
    if (this.active.length >= this.max) return this.replaceLower(this.active, entry);
    this.active.push(entry);
    return true;
  }

  private replaceLower(pool: ActiveDisruption[], entry: ActiveDisruption): boolean {
    const lowest = pool.reduce<ActiveDisruption | null>((m, a) => (!m || a.priority < m.priority ? a : m), null);
    if (!lowest || lowest.priority >= entry.priority) return false;
    this.active = this.active.filter((a) => a !== lowest);
    this.active.push(entry);
    return true;
  }

  /** 시간이 다 된 것 제거, 제거된 목록 */
  update(nowSec: number): ActiveDisruption[] {
    const gone = this.active.filter((a) => a.untilSec <= nowSec);
    if (gone.length > 0) this.active = this.active.filter((a) => a.untilSec > nowSec);
    return gone;
  }

  /**
   * 적이 거는 방해: 같은 종류가 있으면 원인만 더하고, 없으면 새로 건다(시간 무제한, 원인이 모두 죽으면 해제).
   * 자리가 없고 우선순위도 낮으면 거절(false).
   */
  addSource(d: { type: string; category: string; priority: number }, sourceId: string): boolean {
    const same = this.active.find((a) => a.type === d.type);
    if (same) {
      same.sources ??= [];
      if (!same.sources.includes(sourceId)) same.sources.push(sourceId);
      same.untilSec = Infinity;
      return true;
    }
    const ok = this.add({ ...d, source: 'enemy', durationSec: Infinity }, 0);
    const added = this.active.find((a) => a.type === d.type);
    if (ok && added) added.sources = [sourceId];
    return ok;
  }

  /** 원인 적이 죽음: 그 적이 건 방해에서 빼고, 원인이 하나도 안 남은 방해는 해제. 해제된 목록 */
  removeSource(sourceId: string): ActiveDisruption[] {
    const gone: ActiveDisruption[] = [];
    for (const a of this.active) {
      if (!a.sources?.includes(sourceId)) continue;
      a.sources = a.sources.filter((s) => s !== sourceId);
      if (a.sources.length === 0) gone.push(a);
    }
    if (gone.length > 0) this.active = this.active.filter((a) => !gone.includes(a));
    return gone;
  }

  /** 지금 이 방해의 원인 적 ID들 */
  sourcesOf(type: string): readonly string[] {
    return this.active.find((a) => a.type === type)?.sources ?? [];
  }

  /** 하나 해제(통신 복구): 가장 최근 것 */
  clearOne(): ActiveDisruption | null {
    return this.active.pop() ?? null;
  }

  /** 출처가 사라지면(방해를 건 적 처치) 함께 해제 */
  clearSource(source: string): number {
    const n = this.active.length;
    this.active = this.active.filter((a) => a.source !== source);
    return n - this.active.length;
  }

  has(type: string): boolean {
    return this.active.some((a) => a.type === type);
  }

  remaining(type: string, nowSec: number): number {
    const a = this.active.find((x) => x.type === type);
    return a ? Math.max(0, a.untilSec - nowSec) : 0;
  }
}
