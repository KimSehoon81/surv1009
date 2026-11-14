import { describe, expect, it } from 'vitest';
import support from '../src/data/support.json';
import cardsData from '../src/data/cards.json';
import { due, dropPoint, formationSlot, pickWeighted } from '../src/core/support';
import { createRng } from '../src/core/rng';
import { EFFECTS } from '../src/systems/effects';

describe('전투 지원(보급 투하·우방군)', () => {
  it('일정: 첫 시각 → 주기마다 한 번', () => {
    const { firstSec, everySec } = support.airdrop;
    expect(due(firstSec - 1, firstSec, everySec, null)).toBeNull();
    expect(due(firstSec, firstSec, everySec, null)).toBe(firstSec);
    expect(due(firstSec + everySec - 1, firstSec, everySec, firstSec)).toBeNull();
    expect(due(firstSec + everySec + 5, firstSec, everySec, firstSec)).toBe(firstSec + everySec);
  });

  it('보상은 가중치대로 모두 나오고 같은 시드면 같은 순서', () => {
    const seen = new Set<string>();
    const rng = createRng('drop');
    for (let i = 0; i < 400; i++) seen.add(pickWeighted(rng, support.airdrop.rewards)?.id ?? '');
    expect([...seen].sort()).toEqual(support.airdrop.rewards.map((r) => r.id).sort());
    const a = createRng('s');
    const b = createRng('s');
    expect(pickWeighted(a, support.airdrop.rewards)?.id).toBe(pickWeighted(b, support.airdrop.rewards)?.id);
  });

  it('보상 효과는 있는 핸들러, 줄 카드는 있는 카드', () => {
    for (const r of support.airdrop.rewards)
      for (const e of r.effects) {
        expect(EFFECTS, `${r.id}:${e.effect}`).toHaveProperty(e.effect);
        const ids = (e.params as { ids?: string }).ids;
        if (ids) for (const id of ids.split(',')) expect(cardsData.cards, id).toHaveProperty(id);
      }
  });

  it('떨어질 자리는 거리 범위 안(세로는 납작), 분대 자리는 바라보는 쪽', () => {
    const rng = createRng('p');
    const [lo, hi] = support.airdrop.distance as [number, number];
    for (let i = 0; i < 50; i++) {
      const p = dropPoint(rng, 0, 0, lo, hi);
      expect(Math.hypot(p.x, p.y / 0.75)).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(Math.hypot(p.x, p.y / 0.75)).toBeLessThanOrEqual(hi + 1e-6);
    }
    const n = support.squad.units.length;
    for (let i = 0; i < n; i++) expect(formationSlot(i, n, support.squad.ring, 1).x).toBeGreaterThanOrEqual(-1e-6);
    for (let i = 0; i < n; i++) expect(formationSlot(i, n, support.squad.ring, -1).x).toBeLessThanOrEqual(1e-6);
  });
});
