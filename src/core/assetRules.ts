// public/assets 파일 규격 판정(순수 함수). 규격 원본은 src/data/assets.json과 docs/ASSETS.md.
// tools/check-assets.ts가 PNG 헤더(크기·색 형식)를 읽어 이 함수에 넘긴다.
import spec from '../data/assets.json';

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
    : [{ severity: 'error', message: `${what} 크기는 ${w}×${h}이어야 함 (현재 ${info.width}×${info.height})` }];
}

function alphaIssue(info: PngInfo): Issue[] {
  return info.colorType === 6 || info.colorType === 4 || info.colorType === 3
    ? []
    : [{ severity: 'warn', message: '투명 채널이 없음(배경이 칠해져 보일 수 있음)' }];
}

/** relPath: public/assets 기준 경로(예: chars/A01_attack.png) */
export function checkAsset(relPath: string, info: PngInfo | null): Issue[] {
  const parts = relPath.split('/');
  const folder = parts.length > 1 ? (parts[0] as string) : '';
  const name = parts[parts.length - 1] as string;
  if (folder === 'audio') return /\.(ogg|mp3|wav)$/i.test(name) ? [] : [{ severity: 'warn', message: '오디오 폴더에 오디오가 아닌 파일' }];
  if (!name.toLowerCase().endsWith('.png')) return [{ severity: 'warn', message: 'PNG가 아닌 파일(게임이 사용하지 않음)' }];
  if (!info) return [{ severity: 'error', message: 'PNG 헤더를 읽을 수 없음(손상된 파일)' }];

  const sheet = (large: boolean) => (large ? spec.sheet.frameLarge : spec.sheet.frame) * spec.sheet.cols;

  const faction = FACTION_BY_FOLDER[folder];
  if (faction) {
    const m = UNIT_FILE.exec(name);
    if (!m) return [{ severity: 'error', message: '파일명이 <ID>_<동작>.png 규칙에 맞지 않음 (예: A01_attack.png)' }];
    const [, id, action, large] = m as unknown as [string, string, string, string | undefined];
    const issues: Issue[] = [];
    const expected = spec.idPrefix[id[0] as keyof typeof spec.idPrefix];
    if (expected !== faction) issues.push({ severity: 'error', message: `${id}는 ${folder}/ 폴더가 아님(${spec.folders[expected as Faction]}/에 넣어야 함)` });
    const actions = [...spec.actions[faction], ...spec.optionalActions[faction]];
    if (!actions.includes(action)) issues.push({ severity: 'error', message: `알 수 없는 동작 "${action}" (가능: ${actions.join(', ')})` });
    const size = sheet(Boolean(large));
    return [...issues, ...sizeIssue(info, size, size, large ? '대형(_L) 시트' : '시트'), ...alphaIssue(info)];
  }

  switch (folder) {
    case 'tiles':
      return /^T\d{2}\.png$/.test(name)
        ? sizeIssue(info, spec.tile.size, spec.tile.size, '타일')
        : [{ severity: 'error', message: '타일 파일명은 T01.png 형식' }];
    case 'cards':
      if (/^(frame_(common|rare|legend|minus)|card_back)\.png$/.test(name)) return sizeIssue(info, spec.card.width, spec.card.height, '카드 프레임');
      if (/^[PM]\d{2}\.png$/.test(name)) return sizeIssue(info, spec.cardArt.width, spec.cardArt.height, '카드 일러스트');
      return [{ severity: 'warn', message: '알 수 없는 카드 파일명' }];
    case 'ui':
      if (name.startsWith('overlay_')) return [...sizeIssue(info, spec.card.width, spec.card.height, '오버레이'), ...alphaIssue(info)];
      return [...sizeIssue(info, spec.icon, spec.icon, '아이콘'), ...alphaIssue(info)];
    case 'skills':
      return /^AS\d{2}\.png$/.test(name)
        ? [...sizeIssue(info, spec.icon, spec.icon, '스킬 아이콘'), ...alphaIssue(info)]
        : [{ severity: 'error', message: '스킬 아이콘 파일명은 AS01.png 형식' }];
    case 'fx':
    case 'props': {
      const large = name.endsWith('_L.png') || (folder === 'fx' && info.width === sheet(true));
      const size = sheet(large);
      return [...sizeIssue(info, size, size, folder === 'fx' ? '이펙트 시트' : '소품 시트'), ...alphaIssue(info)];
    }
    case 'map':
      return name === 'korea_map.png' ? sizeIssue(info, spec.map.width, spec.map.height, '작전지도') : [{ severity: 'warn', message: '알 수 없는 지도 파일' }];
    default:
      return [{ severity: 'warn', message: `알 수 없는 폴더 "${folder || '(루트)'}"` }];
  }
}
