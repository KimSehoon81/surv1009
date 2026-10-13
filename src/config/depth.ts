// 그리기 순서(PRD §6.4): 바닥 → 바닥 데칼 → 그림자 → 유닛 → 투사체 → 폭발 → 연기 → UI
// 값의 크기 순서가 곧 레이어 순서다(tests/feel.test.ts에서 검사).
export const Depth = {
  Floor: 0,
  FloorPatch: 1,
  /** 바닥 데칼: 포탄 자국 등 */
  Decal: 10,
  Shadow: 20,
  Unit: 100,
  /** 적(Unit + y 비율 0~1)보다 항상 앞 */
  Player: 150,
  Projectile: 200,
  Explosion: 300,
  /** 스파크·파편·탄피(폭발 계열 입자) */
  Spark: 310,
  Smoke: 400,
  /** 하늘: 폭격기 등 지나가는 비행체(연기 위, 숫자 아래) */
  Air: 450,
  /** 데미지 숫자(월드 좌표지만 연출보다 앞) */
  DamageText: 900,
  /** 화면 전체 플래시·피격 비네팅 */
  ScreenFx: 950,
  Ui: 1000,
  Debug: 10_000,
} as const;

/** §6.4 레이어 순서 */
export const LAYER_ORDER = ['Floor', 'Decal', 'Shadow', 'Unit', 'Projectile', 'Explosion', 'Smoke', 'Ui'] as const;
