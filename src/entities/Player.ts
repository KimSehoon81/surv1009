import * as Phaser from 'phaser';
import characters from '../data/characters.json';
import { manifest } from '../assets/manifest';
import { createAnimState, triggerAction, updateAnimState, type AnimState } from '../core/animState';
import { facingFrom, step } from '../core/movement';
import { registerUnitAnims, type UnitAnims } from '../systems/anims';
import type { InputMap } from '../systems/input';

export type CharacterId = keyof typeof characters.characters;
export type Stats = (typeof characters.characters)[CharacterId]['stats'];

export function isCharacterId(id: string): id is CharacterId {
  return id in characters.characters;
}

/** 플레이어 캐릭터: 이동·좌우 반전·동작 상태 머신. 시간은 모두 전투 시계(clock) 기준 */
export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  id: CharacterId;
  stats: Stats;
  /** 이동 속도 배율(슬로우 디버프·가속 버프가 바꾼다). 1 = 기본 */
  speedMul = 1;
  private facing: 1 | -1 = 1;
  private anims!: UnitAnims;
  private anim!: AnimState;
  private moving = false;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    id: CharacterId,
  ) {
    this.id = id;
    this.stats = characters.characters[id].stats;
    this.sprite = scene.add.sprite(x, y, manifest.sheetKey(id, 'move_slow'), 0).setOrigin(manifest.anchor.x, manifest.anchor.y);
    this.setCharacter(id, 0);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  /** 캐릭터 교체(출정 준비·디버그). 위치와 바라보는 방향은 유지 */
  setCharacter(id: CharacterId, nowMs: number): void {
    this.id = id;
    this.stats = characters.characters[id].stats;
    this.anims = registerUnitAnims(this.scene, id);
    this.anim = createAnimState(this.anims.rules, nowMs);
    this.applyAnim(true);
  }

  /** 한 번 재생 동작(공격·방어·스킬·치명타) */
  trigger(action: string, nowMs: number): void {
    const frames = this.anims.frames[action];
    if (frames === undefined) return;
    this.anim = triggerAction(this.anim, this.anims.rules, action, frames, nowMs);
    this.applyAnim(false);
  }

  get action(): string {
    return this.anim.current;
  }

  /**
   * @param dtMs 전투 시계 기준 경과 시간(일시정지·히트스톱이면 0)
   * @param nowMs 전투 시계 누적 시간
   * @param timeScale 전투 시계 배율(애니메이션 재생 속도에 반영)
   */
  update(input: InputMap, dtMs: number, nowMs: number, timeScale: number): void {
    const dir = input.moveVector();
    this.moving = dir.x !== 0 || dir.y !== 0;
    if (this.moving && dtMs > 0) {
      const next = step(this.sprite, dir, this.stats.moveSpeed * this.speedMul, dtMs);
      this.sprite.setPosition(next.x, next.y);
    }
    this.facing = facingFrom(dir.x, this.facing);
    this.sprite.setFlipX(this.facing < 0);
    this.anim = updateAnimState(this.anim, this.anims.rules, { moving: this.moving, speedRatio: this.speedMul }, nowMs);
    this.applyAnim(false);
    this.sprite.anims.timeScale = timeScale;
  }

  private lastKey = '';
  private lastStart = -1;

  /** 상태 머신 결과가 바뀌었을 때만 재생을 (다시) 시작한다 */
  private applyAnim(force: boolean): void {
    const key = this.anims.keys[this.anim.current];
    if (!key) return;
    if (force || key !== this.lastKey || this.anim.startedMs !== this.lastStart) {
      this.sprite.play(key);
      this.lastKey = key;
      this.lastStart = this.anim.startedMs;
    }
  }
}
