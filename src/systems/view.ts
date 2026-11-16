// 화면 맞춤: 창 크기 → 배율, 세로로 든 터치 기기에서는 컨테이너를 90° 돌려 가로 화면으로(포인터 좌표도 같이 변환)
import type * as Phaser from 'phaser';
import { computeZoom } from '../config/display';
import { toView, viewLayout } from '../core/touch';
import { isTouchDevice } from './touch';

export interface View {
  rotated: boolean;
  /** 게임이 쓰는 가로·세로(CSS px, 돌린 뒤 기준) */
  width: number;
  height: number;
  /** 창의 가로(좌표 변환용) */
  winW: number;
  zoom: number;
}

let view: View = { rotated: false, width: 960, height: 540, winW: 960, zoom: 1 };
export const currentView = (): View => view;

function windowSize(): { w: number; h: number } {
  // iOS: 주소창이 접히고 펴질 때 innerHeight보다 visualViewport가 정확
  const vv = window.visualViewport;
  return { w: Math.round(vv?.width ?? window.innerWidth), h: Math.round(vv?.height ?? window.innerHeight) };
}

/** 컨테이너 크기·회전과 배율을 지금 창에 맞춤. 배율을 돌려줌 */
export function layoutView(parent: HTMLElement): View {
  const { w, h } = windowSize();
  const l = viewLayout(w, h, isTouchDevice());
  const zoom = computeZoom(l.width, l.height);
  view = { rotated: l.rotated, width: l.width, height: l.height, winW: w, zoom };
  const s = parent.style;
  s.width = `${l.width}px`;
  s.height = `${l.height}px`;
  s.transform = l.rotated ? `translateX(${w}px) rotate(90deg)` : '';
  // 조작판 버튼 크기 단위(가로 화면 높이의 1%)
  s.setProperty('--u', `${l.height / 100}px`);
  // 정수 배율이 아니면(휴대폰) 도트 필터 대신 부드럽게: 글자 획이 들쭉날쭉해지지 않게
  parent.classList.toggle('smooth', zoom < 1 || !Number.isInteger(zoom));
  parent.classList.toggle('rot', l.rotated);
  return view;
}

/** 돌린 화면에서도 포인터가 맞는 자리를 가리키게(Phaser는 CSS 회전을 모름) */
export function installPointerTransform(game: Phaser.Game): void {
  type P = { position: { x: number; y: number }; prevPosition: { x: number; y: number }; smoothFactor: number };
  const im = game.input as unknown as { transformPointer(p: P, x: number, y: number, wasMove: boolean): void };
  const orig = im.transformPointer.bind(im);
  im.transformPointer = (pointer, pageX, pageY, wasMove) => {
    if (!view.rotated) return orig(pointer, pageX, pageY, wasMove);
    const p0 = pointer.position;
    const p1 = pointer.prevPosition;
    p1.x = p0.x;
    p1.y = p0.y;
    const v = toView(pageX - window.scrollX, pageY - window.scrollY, view.winW, true);
    const c = game.canvas;
    const x = (v.x - c.offsetLeft) / view.zoom;
    const y = (v.y - c.offsetTop) / view.zoom;
    const a = pointer.smoothFactor;
    if (!wasMove || a === 0) {
      p0.x = x;
      p0.y = y;
    } else {
      p0.x = x * a + p1.x * (1 - a);
      p0.y = y * a + p1.y * (1 - a);
    }
  };
}
