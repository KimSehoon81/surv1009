// itch.io용 zip(D45): dist/를 dist-zip/amnok-survival-<버전>.zip으로(index.html이 zip 최상위). 먼저 npm run build:release
// zip 명령이 없으면 python3 zipfile로 만든다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
if (!existsSync(resolve(dist, 'index.html'))) {
  console.error('dist/index.html이 없습니다. 먼저 npm run build:release');
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const outDir = resolve(root, 'dist-zip');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `amnok-survival-${version}.zip`);
rmSync(out, { force: true });
const py = `import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk(src):
        for f in fs:
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, src))
`;
execFileSync('python3', ['-c', py, dist, out], { stdio: 'inherit' });
console.log(`만듦: ${out}`);
