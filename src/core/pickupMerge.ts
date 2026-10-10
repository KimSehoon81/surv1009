// 경험치 보급품 상한 처리(순수 함수): 상한에 닿으면 가장 오래된 두 개를 하나로 합쳐 자리를 만든다.

export interface Aged {
  bornMs: number;
  value: number;
}

/** 가장 오래된 것(remove)과 두 번째로 오래된 것(into)의 인덱스. 두 개 미만이면 null */
export function oldestPair(items: readonly Aged[]): { remove: number; into: number } | null {
  if (items.length < 2) return null;
  let a = -1;
  let b = -1;
  for (let i = 0; i < items.length; i++) {
    const t = (items[i] as Aged).bornMs;
    if (a < 0 || t < (items[a] as Aged).bornMs) {
      b = a;
      a = i;
    } else if (b < 0 || t < (items[b] as Aged).bornMs) {
      b = i;
    }
  }
  return { remove: a, into: b };
}

/** 값에 따른 표시 크기 배율(병합된 별일수록 조금 크게) */
export function pickupScale(value: number, base: number): number {
  return base * (1 + Math.min(1, Math.log2(Math.max(1, value)) * 0.15));
}
