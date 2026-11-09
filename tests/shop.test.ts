import { describe, expect, it } from 'vitest';
import shopData from '../src/data/shop.json';
import { buy, canBuy, remaining, type ShopItem } from '../src/core/shop';

const ITEMS = shopData.items as ShopItem[];
const item = (id: string) => ITEMS.find((i) => i.id === id) as ShopItem;

describe('전공 상점(N03, D26)', () => {
  it('품목 10종, 가격·재고 양수, 효과 이름 있음', () => {
    expect(ITEMS).toHaveLength(10);
    for (const i of ITEMS) {
      expect(i.cost, i.id).toBeGreaterThan(0);
      expect(i.stock, i.id).toBeGreaterThan(0);
      expect(i.effect, i.id).toBeTruthy();
    }
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('구매하면 전공 차감·재고 소진, 원래 상태는 그대로', () => {
    const s0 = { merit: 100, bought: {} };
    const r = buy(s0, ITEMS, 'heal');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.merit).toBe(100 - item('heal').cost);
    expect(remaining(r.state, item('heal'))).toBe(item('heal').stock - 1);
    expect(s0).toEqual({ merit: 100, bought: {} });
  });

  it('재고 없음·전공 부족·없는 품목은 거부', () => {
    const crate = item('crate');
    let s = { merit: 1000, bought: {} as Record<string, number> };
    for (let k = 0; k < crate.stock; k++) {
      const r = buy(s, ITEMS, 'crate');
      if (r.ok) s = { ...r.state, bought: { ...r.state.bought } };
    }
    expect(buy(s, ITEMS, 'crate')).toEqual({ ok: false, reason: 'soldOut' });
    expect(buy({ merit: 10, bought: {} }, ITEMS, 'morale')).toEqual({ ok: false, reason: 'merit' });
    expect(buy({ merit: 999, bought: {} }, ITEMS, 'nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(canBuy({ merit: item('map').cost, bought: {} }, item('map'))).toBeNull();
  });
});
