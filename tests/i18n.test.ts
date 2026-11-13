import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { TABLES, getLocale, setLocale, t } from '../src/i18n';
import { DATA_FILES, applyDataLocale, resolvePath } from '../src/i18n/data';
import overlays from '../src/i18n/data.json';
import settings from '../src/data/settings.json';

const HANGUL = /[가-힣ㄱ-ㆎ]/;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
const SRC = files('src').filter((f) => !f.replace(/\\/g, '/').startsWith('src/i18n/'));

/** 문자열·템플릿 리터럴 조각만 모음(주석 제외) */
function literals(file: string): { line: number; text: string }[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: { line: number; text: string }[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n))
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text: n.text });
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n(D42)', () => {
  afterEach(() => {
    setLocale('ko');
    applyDataLocale('ko');
  });

  it('코드의 한글 문자열 리터럴은 i18n 밖에 없다(주석 제외)', () => {
    const found = SRC.flatMap((f) => literals(f).filter((l) => HANGUL.test(l.text)).map((l) => `${f}:${l.line} ${l.text.slice(0, 40)}`));
    expect(found).toEqual([]);
  });

  it('ko·en 키가 같고 자리표시자도 같다', () => {
    expect(Object.keys(TABLES.en).sort()).toEqual(Object.keys(TABLES.ko).sort());
    for (const [k, v] of Object.entries(TABLES.ko)) expect(vars(TABLES.en[k] ?? ''), k).toEqual(vars(v));
  });

  it("코드가 부르는 t('키')는 모두 ko.json에 있다(템플릿 키는 앞부분이 있는지)", () => {
    const keys = Object.keys(TABLES.ko);
    const missing: string[] = [];
    for (const f of SRC) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) if (!(m[1]! in TABLES.ko)) missing.push(`${f} ${m[1]}`);
      for (const m of src.matchAll(/\bt\(`([\w.]+)\$\{/g)) if (!keys.some((k) => k.startsWith(m[1]!))) missing.push(`${f} ${m[1]}…`);
    }
    expect(missing).toEqual([]);
  });

  it('t: 자리표시자 채우기, 없는 키는 키 그대로, 영어 전환과 되돌리기', () => {
    expect(t('hud.merit', { n: 30 })).toBe('전공 30');
    expect(t('no.such.key')).toBe('no.such.key');
    expect(setLocale('en')).toBe('en');
    expect(t('hud.merit', { n: 30 })).toBe('Merit 30');
    expect(setLocale('xx')).toBe('ko');
    expect(getLocale()).toBe('ko');
  });

  it('데이터 번역 경로는 모두 실제 문자열을 가리키고, 적용·복원된다', () => {
    for (const [locale, table] of Object.entries(overlays as Record<string, Record<string, Record<string, string>>>))
      for (const [file, entries] of Object.entries(table)) {
        expect(DATA_FILES[file], `${locale}:${file}`).toBeDefined();
        for (const path of Object.keys(entries)) expect(resolvePath(DATA_FILES[file], path), `${locale}:${file}:${path}`).not.toBeNull();
      }
    const ko = settings.tabs[0]!.name;
    expect(applyDataLocale('en')).toBeGreaterThan(50);
    expect(settings.tabs[0]!.name).toBe('Basic');
    applyDataLocale('ko');
    expect(settings.tabs[0]!.name).toBe(ko);
  });
});
