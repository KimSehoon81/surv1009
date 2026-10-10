import type * as Phaser from 'phaser';
import enemyData from '../data/enemies.json';
import { manifest } from '../assets/manifest';
import type { Agent, BehaviorSpec } from '../core/behaviors';
import type { EnemyScale } from '../core/scaling';
import type { Rng } from '../core/rng';
import { createAnimState, triggerAction, updateAnimState, type AnimState } from '../core/animState';
import type { UnitAnims } from '../systems/anims';

export type EnemyId = keyof typeof enemyData.enemies;
export type EnemyDef = (typeof enemyData.enemies)[EnemyId];

export function isEnemyId(id: string): id is EnemyId {
  return id in enemyData.enemies;
}

/** 풀에서 재사용되는 적 한 개체. 위치는 sprite 좌표가 원본 */
export class Enemy implements Agent {
  readonly sprite: Phaser.GameObjects.Sprite;
  id: EnemyId = 'E01';
  def: EnemyDef = enemyData.enemies.E01;
  behaviors: readonly BehaviorSpec[] = [];
  hp = 1;
  maxHp = 1;
  attack = 0;
  speed = 0;
  radius = 12;
  ageMs = 0;
  phase = 0;
  /** 풀에서 꺼내져 살아 있는 동안 true(같은 프레임에 이미 죽은 적을 또 맞히지 않게) */
  alive = false;
  /** 이 시각(전투 시계)까지 피격 경직: 이동하지 않음 */
  stunUntilMs = 0;
  private anims!: UnitAnims;
  private anim!: AnimState;
  private lastKey = '';
  private lastStart = -1;

  constructor(scene: Phaser.Scene) {
    this.sprite = scene.add.sprite(0, 0, manifest.sheetKey('E01', 'move'), 0).setOrigin(manifest.anchor.x, manifest.anchor.y);
    this.sprite.setActive(false).setVisible(false);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  setPosition(x: number, y: number): void {
    this.sprite.x = x;
    this.sprite.y = y;
  }

  spawn(id: EnemyId, anims: UnitAnims, x: number, y: number, scale: EnemyScale, rng: Rng, nowMs: number): void {
    const def = enemyData.enemies[id];
    this.id = id;
    this.def = def;
    this.behaviors = def.behaviors as BehaviorSpec[];
    this.maxHp = Math.max(1, Math.round(def.hp * scale.hp));
    this.hp = this.maxHp;
    this.attack = def.attack * scale.attack;
    this.speed = def.speed * scale.speed * (1 + (rng.next() * 2 - 1) * def.speedJitter);
    this.radius = def.radius;
    this.ageMs = 0;
    this.phase = rng.next();
    this.alive = true;
    this.stunUntilMs = 0;
    this.anims = anims;
    this.anim = createAnimState(anims.rules, nowMs);
    this.lastKey = '';
    this.setPosition(x, y);
    this.sprite.setActive(true).setVisible(true).setFlipX(false).clearTint();
    this.applyAnim();
    // 같은 종류가 똑같은 박자로 걷지 않게 시작 프레임을 흩뜨린다
    this.sprite.anims.setProgress(this.phase);
  }

  despawn(): void {
    this.alive = false;
    this.sprite.anims.stop();
    this.sprite.setActive(false).setVisible(false);
  }

  /** 한 번 재생 동작(피격·공격 등) */
  trigger(action: string, nowMs: number): void {
    const frames = this.anims.frames[action];
    if (frames === undefined) return;
    this.anim = triggerAction(this.anim, this.anims.rules, action, frames, nowMs);
    this.applyAnim();
  }

  updateAnim(moving: boolean, nowMs: number, timeScale: number): void {
    this.anim = updateAnimState(this.anim, this.anims.rules, { moving, speedRatio: 1 }, nowMs);
    this.applyAnim();
    this.sprite.anims.timeScale = timeScale;
  }

  private applyAnim(): void {
    const key = this.anims.keys[this.anim.current];
    if (!key) return;
    if (key !== this.lastKey || this.anim.startedMs !== this.lastStart) {
      this.sprite.play(key);
      this.lastKey = key;
      this.lastStart = this.anim.startedMs;
    }
  }
}
