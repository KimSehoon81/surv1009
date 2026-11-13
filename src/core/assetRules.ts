// public/assets 파일 규격 판정(순수 함수). 규격 원본은 src/data/assets.json과 docs/ASSETS.md.
// tools/check-assets.ts가 PNG 헤더(크기·색 형식)를 읽어 이 함수에 넘긴다.
import spec from '../data/assets.json';
import { t } from '../i18n';

export type Severity = 'error' | 'warn';

export interface Issue {
  severity: Severity;
  message: string;
}

export interface PngInfo {
  width: number;
  height: number;
  /** PNG IHDR 색 형식: 6 = RGBA(투명 채널 있음), 2 = RGB, 3 = 팔레트 */
  colorType: number;
}

type Faction = keyof typeof spec.folders;
const FACTION_BY_FOLDER = Object.fromEntries(Object.entries(spec.folders).map(([f, d]) => [d, f as Faction])) as Record<string, Faction>;
const UNIT_FILE = /^([AEN]\d{2})_([a-z_]+?)(_L)?\.png$/;

function sizeIssue(info: PngInfo, w: number, h: number, what: string): Issue[] {
  return info.width === w && info.height === h
    ? []
    : [{ severity: 'error', message: t('assets.size', { what: t(`assets.kind.${what}`), w, h, cw: info.width, ch: info.height }) }];
}

function alphaIssue(info: PngInfo): Issue[] {
  return info.colorType === 6 || info.colorType === 4 || info.colorType === 3
    ? []
    : [{ severity: 'warn', message: t('assets.noAlpha') }];
}

/** relPath: public/assets 기준 경로(예: chars/A01_attack.png) */
export function checkAsset(relPath: string, info: PngInfo | null): Issue[] {
  const parts = relPath.split('/');
  const folder = parts.length > 1 ? (parts[0] as string) : '';
  const name = parts[parts.length - 1] as string;
  if (folder === 'audio') return /\.(ogg|mp3|wav)$/i.test(name) ? [] : [{ severity: 'warn', message: t('assets.notAudio') }];
  if (!name.toLowerCase().endsWith('.png')) return [{ severity: 'warn', message: t('assets.notPng') }];
  if (!info) return [{ severity: 'error', message: t('assets.badPng') }];

  const sheet = (large: boolean) => (large ? spec.sheet.frameLarge : spec.sheet.frame) * spec.sheet.cols;

  const faction = FACTION_BY_FOLDER[folder];
  if (faction) {
    const m = UNIT_FILE.exec(name);
    if (!m) return [{ severity: 'error', message: t('assets.badUnitName') }];
    const [, id, action, large] = m as unknown as [string, string, string, string | undefined];
    const issues: Issue[] = [];
    const expected = spec.idPrefix[id[0] as keyof typeof spec.idPrefix];
    if (expected !== faction) issues.push({ severity: 'error', message: t('assets.wrongFolder', { id, folder, expected: spec.folders[expected as Faction] }) });
    const actions = [...spec.actions[faction], ...spec.optionalActions[faction]];
    if (!actions.includes(action)) issues.push({ severity: 'error', message: t('assets.badAction', { action, list: actions.join(', ') }) });
    const size = sheet(Boolean(large));
    return [...issues, ...sizeIssue(info, size, size, large ? 'sheetL' : 'sheet'), ...alphaIssue(info)];
  }

  switch (folder) {
    case 'tiles':
      return /^T\d{2}\.png$/.test(name)
        ? sizeIssue(info, spec.tile.size, spec.tile.size, 'tile')
        : [{ severity: 'error', message: t('assets.badTileName') }];
    case 'cards':
      if (/^(frame_(common|rare|legend|minus)|card_back)\.png$/.test(name)) return sizeIssue(info, spec.card.width, spec.card.height, 'cardFrame');
      if (/^[PM]\d{2}\.png$/.test(name)) return sizeIssue(info, spec.cardArt.width, spec.cardArt.height, 'cardArt');
      return [{ severity: 'warn', message: t('assets.badCardName') }];
    case 'ui':
      if (name.startsWith('overlay_')) return [...sizeIssue(info, spec.card.width, spec.card.height, 'overlay'), ...alphaIssue(info)];
      return [...sizeIssue(info, spec.icon, spec.icon, 'icon'), ...alphaIssue(info)];
    case 'skills':
      return /^AS\d{2}\.png$/.test(name)
        ? [...sizeIssue(info, spec.icon, spec.icon, 'skillIcon'), ...alphaIssue(info)]
        : [{ severity: 'error', message: t('assets.badSkillName') }];
    case 'fx':
    case 'props': {
      const large = name.endsWith('_L.png') || (folder === 'fx' && info.width === sheet(true));
      const size = sheet(large);
      return [...sizeIssue(info, size, size, folder === 'fx' ? 'fxSheet' : 'propSheet'), ...alphaIssue(info)];
    }
    case 'map':
      return name === 'korea_map.png' ? sizeIssue(info, spec.map.width, spec.map.height, 'map') : [{ severity: 'warn', message: t('assets.badMapName') }];
    default:
      return [{ severity: 'warn', message: t('assets.badFolder', { folder: folder || t('assets.root') }) }];
  }
}
