// 오브젝트 풀: 전투 중 new를 하지 않도록 미리 만든 객체를 재사용한다(적·투사체·보급품·이펙트).
// 활성 목록에서 제거는 마지막 원소와 자리를 바꾸는 O(1) 방식이라 순서가 보장되지 않는다.
// 순회 중에 release하려면 뒤에서부터 순회할 것(바뀌어 들어오는 원소는 이미 지나간 원소).

export class Pool<T> {
  private readonly free: T[] = [];
  private readonly live: T[] = [];
  private readonly index = new Map<T, number>();
  /** 지금까지 만든 개수(미리 만든 것 포함). 사전 생성량보다 커지면 풀 크기를 늘려야 한다는 신호 */
  created = 0;

  constructor(
    private readonly factory: () => T,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) this.free.push(this.make());
  }

  private make(): T {
    this.created++;
    return this.factory();
  }

  acquire(): T {
    const item = this.free.pop() ?? this.make();
    this.index.set(item, this.live.length);
    this.live.push(item);
    return item;
  }

  /** 활성 상태가 아니면 false(이중 반납 방지) */
  release(item: T): boolean {
    const i = this.index.get(item);
    if (i === undefined) return false;
    const last = this.live.pop() as T;
    if (last !== item) {
      this.live[i] = last;
      this.index.set(last, i);
    }
    this.index.delete(item);
    this.free.push(item);
    return true;
  }

  isActive(item: T): boolean {
    return this.index.has(item);
  }

  get active(): readonly T[] {
    return this.live;
  }

  get size(): number {
    return this.live.length;
  }

  get capacity(): number {
    return this.live.length + this.free.length;
  }
}

/**
 * 상한이 있는 풀(데미지 숫자 40·입자 300, PRD §4.4). 상한에 닿으면 새로 만들지 않고
 * 가장 오래전에 꺼낸 활성 항목을 돌려준다(recycled=true: 호출부가 상태를 덮어써 재시작).
 */
export class CappedPool<T> {
  private readonly pool: Pool<T>;
  private readonly born = new Map<T, number>();
  /** 꺼낸 순서(항목·일련번호). 반납·재사용으로 낡은 칸은 꺼낼 때 건너뛴다 */
  private readonly orderItems: T[] = [];
  private readonly orderSerials: number[] = [];
  private head = 0;
  private serial = 0;

  constructor(
    factory: () => T,
    readonly cap: number,
  ) {
    this.pool = new Pool(factory, cap);
  }

  acquire(): { item: T; recycled: boolean } {
    let item: T;
    let recycled = false;
    if (this.pool.size < this.cap) {
      item = this.pool.acquire();
    } else {
      item = this.takeOldest();
      recycled = true;
    }
    this.born.set(item, this.serial);
    this.orderItems.push(item);
    this.orderSerials.push(this.serial);
    this.serial++;
    if (this.head > 1024 && this.head * 2 > this.orderItems.length) {
      this.orderItems.splice(0, this.head);
      this.orderSerials.splice(0, this.head);
      this.head = 0;
    }
    return { item, recycled };
  }

  private takeOldest(): T {
    while (this.head < this.orderItems.length) {
      const item = this.orderItems[this.head] as T;
      const serial = this.orderSerials[this.head] as number;
      this.head++;
      if (this.pool.isActive(item) && this.born.get(item) === serial) return item;
    }
    throw new Error('CappedPool: 활성 항목이 없는데 상한에 닿음');
  }

  release(item: T): boolean {
    return this.pool.release(item);
  }

  get active(): readonly T[] {
    return this.pool.active;
  }

  get size(): number {
    return this.pool.size;
  }

  get created(): number {
    return this.pool.created;
  }
}
