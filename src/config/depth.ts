// 그리기 순서(PRD §6.4): 바닥 → 바닥 데칼 → 그림자 → 유닛 → 투사체 → 폭발 → 연기 → UI
export const Depth = {
  Floor: 0,
  FloorPatch: 1,
  Decal: 10,
  Shadow: 20,
  Unit: 100,
  /** 적(Unit + y 비율 0~1)보다 항상 앞 */
  Player: 150,
  Projectile: 200,
  Explosion: 300,
  Smoke: 400,
  Ui: 1000,
  Debug: 10_000,
} as const;
