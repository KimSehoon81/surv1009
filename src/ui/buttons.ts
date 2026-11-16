// 화면 안내에 쓰는 버튼 이름(D43 여유): 마지막 입력 장치가 패드면 패드 버튼, 터치면 조작판 글자, 아니면 키(키 재설정 반영)
import { t } from '../i18n';
import { PAD_BIND, lastDevice } from '../systems/pad';
import { keyMap } from '../systems/prefs';
import { touchLabel } from '../systems/touch';

const PRETTY: Record<string, string> = { PLUS: '+', MINUS: '−', NUMPAD_ADD: '+', NUMPAD_SUBTRACT: '−', DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→', ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SPACE: 'Space', ENTER: 'Enter', ESC: 'Esc', SHIFT: 'Shift', BACKSPACE: 'Backspace', UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', TAB: 'Tab' };
export const prettyKey = (k: string): string => PRETTY[k] ?? k;

/** 액션의 첫 버튼 이름. 패드의 'Y:hold'는 'Y 길게' */
export function buttonLabel(action: string): string {
  if (lastDevice() === 'touch') {
    const l = touchLabel(action);
    if (l) return l;
  }
  if (lastDevice() === 'pad') {
    const b = PAD_BIND[action]?.[0];
    if (b) return b.endsWith(':hold') ? t('buttons.hold', { b: b.slice(0, -5) }) : prettyKey(b);
  }
  return prettyKey(keyMap()[action]?.[0] ?? action);
}

/** 인장 제출 버튼: 키보드는 Shift+제출, 패드는 Y 길게 */
export const sealLabel = (): string => (lastDevice() !== 'keyboard' ? buttonLabel('cardSealSubmit') : `${buttonLabel('modShift')}+${buttonLabel('cardSubmit')}`);

/** 도움말 문구의 버튼 이름 묶음(지금 장치 기준): {ok} {back} {up} {down} {left} {right} {inc} {dec} */
export function hintVars(): Record<string, string> {
  return {
    ok: buttonLabel('uiConfirm'),
    back: buttonLabel('uiBack'),
    up: buttonLabel('uiUp'),
    down: buttonLabel('uiDown'),
    left: buttonLabel('uiLeft'),
    right: buttonLabel('uiRight'),
    inc: buttonLabel('uiInc'),
    dec: buttonLabel('uiDec'),
  };
}
