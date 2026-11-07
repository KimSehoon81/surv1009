// 행동형 첫 플레이 가이드(PRD §5.2 v0.2): 상황이 처음 생길 때 한 줄 팁. 프로필당 한 번, 설정에서 끔. Phaser 없음.

export interface GuideState {
  enabled: boolean;
  seen: string[];
}

export class Guide {
  private readonly seen: Set<string>;

  constructor(
    private readonly tips: Readonly<Record<string, string>>,
    private readonly state: GuideState,
    private readonly persist: (s: GuideState) => void,
  ) {
    this.seen = new Set(state.seen);
  }

  get enabled(): boolean {
    return this.state.enabled;
  }

  /** 다 본 팁 수 / 전체 */
  get progress(): { seen: number; total: number } {
    return { seen: Object.keys(this.tips).filter((k) => this.seen.has(k)).length, total: Object.keys(this.tips).length };
  }

  /** 처음 생긴 상황이면 문구(그 뒤로는 null). 꺼져 있으면 늘 null */
  trigger(id: string): string | null {
    if (!this.state.enabled || this.seen.has(id)) return null;
    const text = this.tips[id];
    if (!text) return null;
    this.seen.add(id);
    this.persist({ enabled: this.state.enabled, seen: [...this.seen] });
    return text;
  }

  /** 이미 스스로 해낸 상황: 팁 없이 본 것으로(뒤늦은 안내가 뜨지 않게) */
  skip(id: string): void {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.persist({ enabled: this.state.enabled, seen: [...this.seen] });
  }

  has(id: string): boolean {
    return this.seen.has(id);
  }
}
