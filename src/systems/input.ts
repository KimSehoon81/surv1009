import * as Phaser from 'phaser';
import controls from '../data/controls.json';
import { normalizeAxis, type Vec2 } from '../core/movement';

export type InputAction = keyof typeof controls.keys;

/**
 * 액션 이름 단위 입력(키 재설정은 controls.json만 바꾸면 된다).
 * 한 번 눌림(일시정지·스킬·카드 등)은 키 이벤트로 받아 모아 둔다. 프레임마다 '방금 눌림'을 확인하는 방식은
 * 한 프레임 안에 눌렀다 떼면(빠른 탭) 입력을 놓친다.
 */
export class InputMap {
  private readonly keys = new Map<InputAction, Phaser.Input.Keyboard.Key[]>();
  private readonly pressed = new Set<InputAction>();
  private readonly listeners: Array<[Phaser.Input.Keyboard.Key, () => void]> = [];

  constructor(scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (!kb) throw new Error('키보드 입력을 사용할 수 없음');
    for (const [action, names] of Object.entries(controls.keys) as Array<[InputAction, string[]]>) {
      // enableCapture: 방향키가 페이지를 스크롤하지 않게
      const keys = names.map((n) => kb.addKey(n, true));
      for (const k of keys) {
        const fn = () => this.pressed.add(action);
        k.on('down', fn);
        this.listeners.push([k, fn]);
      }
      this.keys.set(action, keys);
    }
  }

  isDown(action: InputAction): boolean {
    return (this.keys.get(action) ?? []).some((k) => k.isDown);
  }

  /** 이번 프레임까지 눌린 적이 있는지(한 번만 true) */
  justDown(action: InputAction): boolean {
    return this.pressed.delete(action);
  }

  /** 프레임 끝에 호출: 이번 프레임에 쓰지 않은 눌림은 버린다(일시정지 중 누른 키가 풀릴 때 한꺼번에 실행되지 않게) */
  endFrame(): void {
    this.pressed.clear();
  }

  /** 씬 종료 시: 키 객체는 씬 재시작 후에도 재사용되므로 리스너를 떼어 중복 등록을 막는다 */
  destroy(): void {
    for (const [k, fn] of this.listeners) k.off('down', fn);
    this.listeners.length = 0;
    this.pressed.clear();
  }

  /** 정규화된 이동 방향(대각선도 길이 1) */
  moveVector(): Vec2 {
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const y = (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
    return normalizeAxis(x, y);
  }
}
