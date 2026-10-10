import type * as Phaser from 'phaser';

/**
 * 타격감 연출의 단일 진입점. D04는 점멸만, D05에서 히트스톱·흔들림·넉백·데미지 숫자·입자가 여기에 붙는다.
 * 호출하는 쪽(전투 로직)은 "무엇이 맞았는지"만 알리고 연출 방식은 모른다.
 */
export class Feel {
  private readonly flashes = new Map<Phaser.GameObjects.Sprite, number>();

  /** 스프라이트를 color로 ms 동안 꽉 채워 칠한다(흰색 점멸 등). 시간은 실시간 기준 */
  flash(sprite: Phaser.GameObjects.Sprite, color: number, ms: number, nowRealMs: number): void {
    sprite.setTintFill(color);
    this.flashes.set(sprite, nowRealMs + ms);
  }

  /** 적 피격(PRD §4.3: 흰색 점멸) */
  enemyHit(sprite: Phaser.GameObjects.Sprite, crit: boolean, ms: number, nowRealMs: number): void {
    this.flash(sprite, crit ? 0xffe14d : 0xffffff, ms, nowRealMs);
  }

  /** 플레이어 피격: 막았으면 강철색, 아니면 붉은색 */
  playerHit(sprite: Phaser.GameObjects.Sprite, blocked: boolean, ms: number, nowRealMs: number): void {
    this.flash(sprite, blocked ? 0x9fc4ff : 0xff4040, ms, nowRealMs);
  }

  /** 풀로 돌아간 스프라이트의 점멸 기록을 지운다 */
  forget(sprite: Phaser.GameObjects.Sprite): void {
    if (this.flashes.delete(sprite)) sprite.clearTint();
  }

  update(nowRealMs: number): void {
    for (const [sprite, until] of this.flashes) {
      if (nowRealMs >= until) {
        sprite.clearTint();
        this.flashes.delete(sprite);
      }
    }
  }
}
