// 다른 모듈(장면·이름표)보다 먼저 언어를 정하고 데이터 문자열을 바꿈. main.ts 첫 import
import { prefs } from '../systems/prefs';
import { applyDataLocale } from './data';
import { setLocale } from './index';

const locale = setLocale(prefs().lang);
applyDataLocale(locale);
if (typeof document !== 'undefined') document.documentElement.lang = locale;
