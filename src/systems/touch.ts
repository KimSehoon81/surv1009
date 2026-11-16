// 터치 조작판(모바일): 캔버스 위에 얹는 DOM 버튼. 전투 = 가상 조이스틱 + 질주·스킬·제출, 그 밖 = 방향·확인·뒤로.
// 버튼은 controls.json 액션 이름으로만 눌림을 넣고(InputMap이 키보드·패드와 똑같이 받음), 자리는 index.html의 CSS(.t-*)
import controls from '../data/controls.json';
import touchData from '../data/touch.json';
import { t } from '../i18n';
import { actionsForButton, clampStick, stickVector, toView, toViewDelta } from '../core/touch';
import type { Vec2 } from '../core/movement';
import { PAD_BIND, PAD_CFG, lastDevice, setDevice } from './pad';

export interface TouchContext {
  /** none = 조작판 숨김(불러오는 중), battle = 전투 조작, menu = 방향·확인·뒤로 */
  mode: 'none' | 'battle' | 'menu';
  /** 스킬 칸이 열려 있는지(전투) */
  skills?: readonly boolean[];
  /** 다시·초기화 버튼(성장 지도·결과·레벨업) */
  again?: boolean;
  /** +/− 버튼(출정 준비·설정) */
  adjust?: boolean;
}

interface ButtonDef {
  cls: string;
  label: string;
  act?: string;
  acts?: string[];
  pad?: string;
  slot?: number;
  show?: string;
  repeat?: boolean;
}

const move: Vec2 = { x: 0, y: 0 };
const held = new Set<string>();
const log: { seq: number; action: string }[] = [];
let seq = 0;

/** 조이스틱 방향(길이 0~1) */
export const touchMove = (): Vec2 => move;
export const touchHeld = (action: string): boolean => held.has(action);
export const touchSeq = (): number => seq;

/** 액션 한 번 눌림(살아 있는 InputMap 모두가 다음 프레임에 받음) */
export function touchPress(action: string): void {
  log.push({ seq: ++seq, action });
  if (log.length > 64) log.splice(0, log.length - 64);
}

/** cursor 뒤에 쌓인 눌림 */
export function takeTouch(cursor: number): { next: number; actions: string[] } {
  return { next: seq, actions: log.filter((e) => e.seq > cursor).map((e) => e.action) };
}

const label = (s: string): string => (s.startsWith('@') ? t(s.slice(1)) : s);

/** 화면 안내에 쓰는 버튼 이름(터치 조작판의 글자와 같게). 조작판에 없는 액션이면 null */
export function touchLabel(action: string): string | null {
  const l = (touchData.labels as Record<string, string>)[action];
  return l ? label(l) : null;
}

/** 터치가 주 입력인 기기(휴대폰·태블릿). ?touch=1/0으로 강제 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('touch');
  if (q !== null) return q !== '0';
  return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
}

interface ViewInfo {
  rotated: boolean;
  winW: number;
  height: number;
}

interface Built {
  el: HTMLElement;
  def: ButtonDef;
  actions: string[];
}

/**
 * 조작판을 만들고 프레임마다 맞출 함수를 돌려줌.
 * parent = 게임 컨테이너(화면을 돌리면 조작판도 같이 돎), view = 지금 화면 배치, context = 지금 어떤 조작이 필요한지
 */
export function installTouch(parent: HTMLElement, view: () => ViewInfo, context: () => TouchContext): () => void {
  const root = document.createElement('div');
  root.id = 'touch';
  root.dataset.mode = 'none';
  parent.appendChild(root);

  // 조이스틱: 왼쪽 영역 어디든 누른 자리가 중심
  const zone = document.createElement('div');
  zone.className = 't-zone t-battle';
  const base = document.createElement('div');
  base.className = 't-base';
  const knob = document.createElement('div');
  knob.className = 't-knob';
  base.appendChild(knob);
  zone.appendChild(base);
  root.appendChild(zone);
  let stickId = -1;
  let origin: Vec2 = { x: 0, y: 0 };
  const radius = () => (view().height * touchData.stick.radiusPct) / 100;
  const endStick = () => {
    stickId = -1;
    move.x = 0;
    move.y = 0;
    base.style.display = 'none';
  };
  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== -1) return;
    e.preventDefault();
    stickId = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* 이미 끝난 터치 */
    }
    origin = { x: e.clientX, y: e.clientY };
    const v = view();
    const p = toView(e.clientX, e.clientY, v.winW, v.rotated);
    const zr = { x: zone.offsetLeft, y: zone.offsetTop };
    base.style.display = 'block';
    base.style.left = `${p.x - zr.x}px`;
    base.style.top = `${p.y - zr.y}px`;
    knob.style.transform = 'translate(-50%, -50%)';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    const d = toViewDelta(e.clientX - origin.x, e.clientY - origin.y, view().rotated);
    const r = radius();
    const v = stickVector(d.x, d.y, r, touchData.stick.deadzone);
    move.x = v.x;
    move.y = v.y;
    const k = clampStick(d.x, d.y, r);
    knob.style.transform = `translate(calc(-50% + ${k.x}px), calc(-50% + ${k.y}px))`;
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    zone.addEventListener(ev, (e) => {
      if (e.pointerId === stickId) endStick();
    });

  const built: Built[] = [];
  const make = (def: ButtonDef, group: 'battle' | 'menu') => {
    const el = document.createElement('div');
    el.className = `t-btn t-${group} t-${def.cls}`;
    el.textContent = label(def.label);
    const actions = def.pad ? actionsForButton(PAD_BIND, def.pad) : (def.acts ?? (def.act ? [def.act] : []));
    let timer = 0;
    const fire = () => actions.forEach(touchPress);
    const stop = () => {
      window.clearTimeout(timer);
      el.classList.remove('on');
      actions.forEach((a) => held.delete(a));
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      setDevice('touch');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 무시 */
      }
      el.classList.add('on');
      actions.forEach((a) => held.add(a));
      fire();
      if (def.repeat) {
        const again = () => {
          fire();
          timer = window.setTimeout(again, PAD_CFG.repeatMs);
        };
        timer = window.setTimeout(again, PAD_CFG.repeatDelayMs);
      }
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, stop);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(el);
    built.push({ el, def, actions });
  };
  (touchData.battle as ButtonDef[]).forEach((d) => make(d, 'battle'));
  (touchData.menu as ButtonDef[]).forEach((d) => make(d, 'menu'));

  // 전체 화면(되는 브라우저만): 안드로이드는 가로로 고정까지
  const doc = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  const canFull = Boolean(document.fullscreenEnabled && doc.requestFullscreen);
  const full = document.createElement('div');
  full.className = 't-btn t-full';
  full.textContent = '⛶';
  full.addEventListener('pointerup', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    doc
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => undefined);
  });
  if (canFull) root.appendChild(full);

  // 첫 터치부터 터치 기기로(키보드를 누르면 InputMap이 keyboard로 되돌려 조작판이 숨음)
  window.addEventListener('touchstart', () => setDevice('touch'), { capture: true, passive: true });
  if (isTouchDevice()) setDevice('touch');
  // 길게 눌러 뜨는 메뉴·두 손가락 확대 막기
  parent.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  let lastKey = '';
  return () => {
    const on = lastDevice() === 'touch';
    const ctx: TouchContext = on ? context() : { mode: 'none' };
    const key = `${ctx.mode}|${ctx.skills?.map((s) => (s ? 1 : 0)).join('') ?? ''}|${ctx.again ? 1 : 0}${ctx.adjust ? 1 : 0}`;
    if (key === lastKey) return;
    lastKey = key;
    root.dataset.mode = ctx.mode;
    if (ctx.mode !== 'battle') endStick();
    held.clear();
    for (const b of built) {
      let show = true;
      if (b.def.slot !== undefined) show = ctx.skills?.[b.def.slot] ?? false;
      if (b.def.show === 'again') show = Boolean(ctx.again);
      if (b.def.show === 'adjust') show = Boolean(ctx.adjust);
      b.el.classList.toggle('off', !show);
      b.el.classList.remove('on');
    }
  };
}

/** 테스트·디버그: 액션 이름이 controls.json에 있는지 */
export const knownAction = (a: string): boolean => a in controls.keys;
