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
