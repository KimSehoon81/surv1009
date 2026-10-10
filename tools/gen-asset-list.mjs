#!/usr/bin/env node
// public/assets를 스캔해 실제로 존재하는 파일 목록을 src/assets/available.json에 쓴다.
// 게임은 이 목록에 있는 파일만 로드하고 나머지는 자리표시자로 그린다(런타임 404 없이).
import { readdirSync, statSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'public', 'assets');
const outFile = join(root, 'src', 'assets', 'available.json');
const EXT = /\.(png|webp|jpg|jpeg|ogg|mp3|wav|json)$/i;

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXT.test(name)) out.push(relative(assetsDir, full).split(sep).join('/'));
  }
  return out;
}

const files = walk(assetsDir).sort();
const json = JSON.stringify(files, null, 2) + '\n';
mkdirSync(dirname(outFile), { recursive: true });
// 내용이 같으면 쓰지 않는다(vite 감시 재시작 방지)
const prev = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
if (prev !== json) writeFileSync(outFile, json);
console.log(`[assets] public/assets 파일 ${files.length}개`);
