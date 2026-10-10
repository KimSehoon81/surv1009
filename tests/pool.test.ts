import { describe, expect, it } from 'vitest';
import { Pool } from '../src/core/pool';

describe('Pool', () => {
  it('미리 만든 개수만큼은 새로 만들지 않고 재사용', () => {
    let made = 0;
    const p = new Pool(() => ({ id: made++ }), 3);
    const a = p.acquire();
    p.acquire();
    p.release(a);
    p.acquire();
    p.acquire();
    expect(made).toBe(3);
    expect(p.size).toBe(3);
    p.acquire(); // 부족하면 늘어난다
    expect(p.created).toBe(4);
  });

  it('이중 반납 방지, 활성 여부', () => {
    const p = new Pool(() => ({}), 1);
    const a = p.acquire();
    expect(p.isActive(a)).toBe(true);
    expect(p.release(a)).toBe(true);
    expect(p.release(a)).toBe(false);
    expect(p.isActive(a)).toBe(false);
  });

  it('뒤에서부터 순회하며 반납해도 모든 원소를 정확히 한 번씩 본다', () => {
    const p = new Pool(() => ({ v: 0 }), 0);
    const items = Array.from({ length: 10 }, (_, i) => Object.assign(p.acquire(), { v: i }));
    const seen: number[] = [];
    const list = p.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i] as { v: number };
      seen.push(it.v);
      if (it.v % 2 === 0) p.release(it);
    }
    expect(seen.sort((a, b) => a - b)).toEqual(items.map((x) => x.v));
    expect(p.active.map((x) => x.v).sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9]);
  });
});
