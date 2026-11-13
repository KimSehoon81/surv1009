import ko from './ko.json';
import en from './en.json';

/** 화면 문자열(D42). 키는 ko.json·en.json의 점 경로, {이름} 자리에 vars를 채움. Phaser 없이 core에서도 씀 */
export type Locale = 'ko' | 'en';
export const LOCALES: readonly Locale[] = ['ko', 'en'];
type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

export const TABLES: Record<Locale, Record<string, string>> = { ko: flatten(ko as Tree), en: flatten(en as Tree) };
let current: Locale = 'ko';

export function setLocale(l: string | undefined): Locale {
  current = (LOCALES as readonly string[]).includes(l ?? '') ? (l as Locale) : 'ko';
  return current;
}
export const getLocale = (): Locale => current;

const fill = (s: string, vars?: Record<string, string | number>): string =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;

/** 현재 언어 → 한국어 → 키 순으로 찾음 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return fill(TABLES[current][key] ?? TABLES.ko[key] ?? key, vars);
}
