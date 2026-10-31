import type * as Phaser from 'phaser';
import npcData from '../data/npcs.json';
import { Pool } from '../core/pool';
import { createAnimState, triggerAction, updateAnimState, type AnimState } from '../core/animState';
import type { Rng } from '../core/rng';
import { Depth } from '../config/depth';
import { manifest } from '../assets/manifest';
import { registerUnitAnims, type UnitAnims } from './anims';

export type NpcId = keyof typeof npcData.npcs;

interface Npc {
  sprite: Phaser.GameObjects.Sprite;
  id: NpcId;
  anims: UnitAnims;
  anim: AnimState;
  lastKey: string;
  lastStart: number;
  bornMs: number;
  /** wait: 기다림, talk: 대화 중, leave: 떠나는 중 */
  state: 'wait' | 'talk' | 'leave';
  stateMs: number;
}

export interface NpcHooks {
  /** 대화 시작(문구 알림) */
  onTalk(id: NpcId, text: string): void;
  /** 지급 순간: 효과 실행은 호출부(효과 레지스트리) */
  onGive(id: NpcId, x: number, y: number): void;
}

/**
 * NPC(진영 neutral, PRD §9.3): 적과 같은 풀·스프라이트·동작 상태 구조지만 적 공간 해시에 들어가지 않아
 * 공격·피격 대상이 아니다. 플레이어가 닿으면 대화 → 지급 → 떠남. 시간은 전투 시계.
 */
export class NpcSystem {
  private readonly pool: Pool<Npc>;
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly rng: Rng,
  ) {
    this.pool = new Pool<Npc>(
      () => ({
        sprite: scene.add.sprite(0, 0, '__DEFAULT').setActive(false).setVisible(false).setOrigin(manifest.anchor.x, manifest.anchor.y),
        id: 'N01',
        anims: registerUnitAnims(scene, 'N01'),
        anim: createAnimState(registerUnitAnims(scene, 'N01').rules),
        lastKey: '',
        lastStart: -1,
        bornMs: 0,
        state: 'wait',
        stateMs: 0,
      }),
      2,
    );
    this.gfx = scene.add.graphics().setDepth(Depth.DamageText - 1);
  }

  get active(): number {
    return this.pool.size;
  }

  /** 플레이어 주변(화면 안) distance 거리에 등장 */
  spawn(id: NpcId, near: { x: number; y: number }, nowMs: number): void {
    const n = this.pool.acquire();
    const a = this.rng.next() * Math.PI * 2;
    n.id = id;
    n.anims = registerUnitAnims(this.scene, id);
    n.anim = createAnimState(n.anims.rules, nowMs);
    n.lastKey = '';
    n.bornMs = nowMs;
    n.state = 'wait';
    n.stateMs = nowMs;
    n.sprite
      .setPosition(near.x + Math.cos(a) * npcData.distance, near.y + Math.sin(a) * npcData.distance * 0.6)
      .setAlpha(1)
      .setFlipX(Math.cos(a) > 0)
      .setActive(true)
      .setVisible(true);
    this.play(n);
  }

  update(nowMs: number, player: { x: number; y: number; radius: number }, hooks: NpcHooks): void {
    const g = this.gfx.clear();
    const list = this.pool.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i] as Npc;
      const s = n.sprite;
      if (n.state === 'wait') {
        const r = npcData.contactRadius + player.radius;
        if ((s.x - player.x) ** 2 + (s.y - player.y) ** 2 <= r * r) {
          n.state = 'talk';
          n.stateMs = nowMs;
          this.trigger(n, 'talk', nowMs);
          hooks.onTalk(n.id, npcData.npcs[n.id].talk);
        } else if (nowMs - n.bornMs > npcData.lifeMs) {
          n.state = 'leave';
          n.stateMs = nowMs;
        } else {
          // 머리 위 초록 "!" 표시(흔들림)
          const bob = Math.sin(nowMs / 160) * 2;
          const y = s.y - 70 + bob;
          g.fillStyle(0x1a1410, 1).fillRect(s.x - 3, y - 1, 6, 14);
          g.fillStyle(0x6fd06f, 1).fillRect(s.x - 2, y, 4, 8).fillRect(s.x - 2, y + 10, 4, 3);
        }
      } else if (n.state === 'talk' && nowMs - n.stateMs >= npcData.talkMs) {
        this.trigger(n, 'give', nowMs);
        hooks.onGive(n.id, s.x, s.y);
        n.state = 'leave';
        n.stateMs = nowMs + 600;
      } else if (n.state === 'leave' && nowMs >= n.stateMs) {
        const k = (nowMs - n.stateMs) / npcData.fadeMs;
        s.setAlpha(Math.max(0, 1 - k));
        if (k >= 1) {
          s.setActive(false).setVisible(false);
          this.pool.release(n);
          continue;
        }
      }
      n.anim = updateAnimState(n.anim, n.anims.rules, { moving: false, speedRatio: 1 }, nowMs);
      this.play(n);
      s.setDepth(Depth.Unit + 0.5);
    }
  }

  private trigger(n: Npc, action: string, nowMs: number): void {
    const frames = n.anims.frames[action];
    if (frames === undefined) return;
    n.anim = triggerAction(n.anim, n.anims.rules, action, frames, nowMs);
    this.play(n);
  }

  private play(n: Npc): void {
    const key = n.anims.keys[n.anim.current];
    if (!key) return;
    if (key !== n.lastKey || n.anim.startedMs !== n.lastStart) {
      n.sprite.play(key);
      n.lastKey = key;
      n.lastStart = n.anim.startedMs;
    }
  }
}
