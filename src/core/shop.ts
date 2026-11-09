// 전공 상점(N03 보급 트럭, PRD §9.3): 품목·재고·전공 차감 규칙. Phaser 없음(테스트 대상). 효과 실행은 호출부(효과 레지스트리).

export interface ShopItem {
  id: string;
  name: string;
  /** 전공 포인트 */
  cost: number;
  /** 한 번 방문에 살 수 있는 수 */
  stock: number;
  effect: string;
  params: Readonly<Record<string, number | string>>;
  desc: string;
}

export interface ShopState {
  merit: number;
  /** 품목 ID → 이번 방문에 산 수 */
  bought: Readonly<Record<string, number>>;
}

export type BuyReject = 'unknown' | 'soldOut' | 'merit';
export type BuyResult = { ok: true; state: ShopState; item: ShopItem } | { ok: false; reason: BuyReject };

export function remaining(s: ShopState, item: ShopItem): number {
  return Math.max(0, item.stock - (s.bought[item.id] ?? 0));
}

/** 살 수 없는 이유(되면 null) */
export function canBuy(s: ShopState, item: ShopItem | undefined): BuyReject | null {
  if (!item) return 'unknown';
  if (remaining(s, item) <= 0) return 'soldOut';
  if (s.merit < item.cost) return 'merit';
  return null;
}

/** 구매: 전공 차감 + 재고 소진. 실패하면 상태는 그대로 */
export function buy(s: ShopState, items: readonly ShopItem[], id: string): BuyResult {
  const item = items.find((i) => i.id === id);
  const why = canBuy(s, item);
  if (why || !item) return { ok: false, reason: why ?? 'unknown' };
  return { ok: true, item, state: { merit: s.merit - item.cost, bought: { ...s.bought, [id]: (s.bought[id] ?? 0) + 1 } } };
}
