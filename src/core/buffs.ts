// 시간제 버프·디버프(PRD §5.3.1 마이너스 카드, 전공 훈장 등). 능력치 수정자에 만료 시각을 붙인 것.
// 같은 id를 다시 걸면 겹치지 않고 새 값·새 지속시간으로 바꾼다(무리수 실패 2배 = "지속 시간도 처음부터").

import type { StatMod } from './stats';

export interface Buff {
  id: string;
  mods: StatMod[];
  untilMs: number;
}

export class Buffs {
  readonly list: Buff[] = [];

  /** 걸기(같은 id면 교체). 바뀌었으면 true */
  add(id: string, mods: readonly StatMod[], durationMs: number, nowMs: number): boolean {
    const i = this.list.findIndex((b) => b.id === id);
    const buff: Buff = { id, mods: [...mods], untilMs: nowMs + durationMs };
    if (i >= 0) this.list[i] = buff;
    else this.list.push(buff);
    return true;
  }

  /** 만료된 것 제거. 하나라도 빠졌으면 true(능력치 다시 계산) */
  expire(nowMs: number): boolean {
    let changed = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      if ((this.list[i]?.untilMs ?? 0) <= nowMs) {
        this.list.splice(i, 1);
        changed = true;
      }
    }
    return changed;
  }

  /** 하나 해제(통신 복구 등). 있었으면 true */
  remove(id: string): boolean {
    const i = this.list.findIndex((b) => b.id === id);
    if (i < 0) return false;
    this.list.splice(i, 1);
    return true;
  }

  mods(): StatMod[] {
    return this.list.flatMap((b) => b.mods);
  }

  has(id: string): boolean {
    return this.list.some((b) => b.id === id);
  }

  remaining(id: string, nowMs: number): number {
    const b = this.list.find((x) => x.id === id);
    return b ? Math.max(0, b.untilMs - nowMs) : 0;
  }
}
