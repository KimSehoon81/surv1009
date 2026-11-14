// 메뉴·작전지도·출정 준비 화면 공용 소리(2026-11-14): 한 번 만들어 계속 써서 메뉴 곡이 화면을 넘어가도 끊기지 않음
import type * as Phaser from 'phaser';
import { createRng } from '../core/rng';
import { AudioSystem } from './audio';

let front: AudioSystem | null = null;
const CALM = { paused: false, slowmo: false, judge: false };

/** 공용 소리를 (없으면 만들어) 메뉴 곡을 튼다 */
export function playMenuMusic(scene: Phaser.Scene): void {
  front ??= new AudioSystem(scene, createRng('front'));
  front.playBgm('bgm_menu');
  front.update(CALM, 0, 0);
}

/** 메뉴 화면 효과음(sfx.json cues 이름) */
export function frontSfx(scene: Phaser.Scene, cue: string): void {
  front ??= new AudioSystem(scene, createRng('front'));
  front.play(cue);
}

/** 설정 화면에서 볼륨을 바꿨을 때 바로 반영 */
export function frontVolume(bus: 'master' | 'bgm' | 'sfx' | 'ui', v: number): void {
  if (!front) return;
  front.setVolume(bus, v);
  front.update(CALM, 0, 0);
}
