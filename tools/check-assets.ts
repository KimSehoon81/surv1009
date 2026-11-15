// public/assets 규격 검사: npm run assets:check
// PNG 헤더(IHDR)만 읽어 크기·색 형식을 확인하므로 빠르고 의존성이 없다. 이미지는 고치지 않는다(변환은 tools/art/postprocess.py).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { checkAsset, type PngInfo } from '../src/core/assetRules';

const root = join(import.meta.dirname, '..', 'public', 'assets');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith('.')) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function readPngInfo(buf: Buffer): PngInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 33 || sig.some((b, i) => buf[i] !== b) || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] as number };
}

const files = walk(root).sort();
let errors = 0;
let warns = 0;
for (const full of files) {
  const rel = relative(root, full).split(sep).join('/');
  const info = rel.toLowerCase().endsWith('.png') ? readPngInfo(readFileSync(full)) : null;
  for (const issue of checkAsset(rel, info)) {
    if (issue.severity === 'error') errors++;
    else warns++;
    console.log(`${issue.severity === 'error' ? '오류' : '주의'}  ${rel}: ${issue.message}`);
  }
}
// 같은 동작의 일반(100px)·큰(_L, 200px) 시트가 둘 다 있으면 게임은 _L만 쓴다 → 일반 파일은 예전 변환의 찌꺼기
const rels = new Set(files.map((f) => relative(root, f).split(sep).join('/')));
for (const rel of rels) {
  if (!rel.endsWith('_L.png')) continue;
  const plain = rel.replace(/_L\.png$/, '.png');
  if (rels.has(plain)) {
    warns++;
    console.log(`주의  ${plain}: 같은 동작의 큰 시트(${rel.split('/').pop()})가 있어 쓰이지 않음 → 지워도 됨`);
  }
}
console.log(`\n[assets:check] 파일 ${files.length}개, 오류 ${errors}개, 주의 ${warns}개`);
process.exit(errors > 0 ? 1 : 0);
