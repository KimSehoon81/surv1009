// 방해 관리자(PRD §5.4 v0.2): 동시 최대 2개, 카드를 가리는 방해(분류 a)는 1개. 상태만 두고 표현은 HUD가 읽는다.
// source = 방해를 건 쪽(stage·적 ID·NPC). 적이 건 방해는 그 적을 처치하면 풀린다(G6, 해당 Day에 연결).

export interface ActiveDisruption {
  type: string;
  category: string;
  source: string;
  priority: number;
  untilSec: number;
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
