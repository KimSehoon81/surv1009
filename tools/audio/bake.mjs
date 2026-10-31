#!/usr/bin/env node
// 합성 효과음 굽기: src/data/sfx.json의 sources → WAV(ffmpeg가 있으면 OGG·MP3도). `npm run audio:bake`
// 음량은 피크 −1dBFS로 정규화, 앞 무음 5ms 이하. 결과는 tools/audio/out/(게임에 쓰려면 public/assets/audio/로 복사).
// 사용: tsx tools/audio/bake.mjs [출력 폴더] [소리 이름…]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import sfx from '../../src/data/sfx.json' with { type: 'json' };
import { synthesize } from '../../src/core/synth.ts';
import { encodeWav, leadingSilenceMs, normalize, peak, trimLeading } from '../../src/core/wav.ts';
import { createRng } from '../../src/core/rng.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [outArg, ...only] = process.argv.slice(2);
const out = outArg ? resolve(outArg) : join(root, 'tools', 'audio', 'out');
const SR = 44100;
mkdirSync(out, { recursive: true });
const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

let n = 0;
for (const [name, src] of Object.entries(sfx.sources)) {
  if (only.length > 0 && !only.includes(name)) continue;
  const variants = Math.max(1, src.variants ?? 1);
  const rng = createRng(`bake:${name}`);
  for (let i = 0; i < variants; i++) {
    const vary = src.vary ?? 0;
    const mul = variants === 1 ? 1 : 1 - vary + (2 * vary * i) / (variants - 1);
    const data = normalize(trimLeading(synthesize(src.layers, SR, () => rng.next(), mul), SR), -1);
    const file = variants === 1 ? name : `${name}_${i + 1}`;
    const wav = join(out, `${file}.wav`);
    writeFileSync(wav, encodeWav(data, SR));
    if (ffmpeg) {
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', '5', join(out, `${file}.ogg`)]);
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', join(out, `${file}.mp3`)]);
    }
    const db = 20 * Math.log10(peak(data));
    console.log(`${file.padEnd(16)} ${(data.length / SR * 1000).toFixed(0).padStart(5)}ms  피크 ${db.toFixed(1)}dB  앞 무음 ${leadingSilenceMs(data, SR).toFixed(1)}ms`);
    n++;
  }
}
console.log(`[bake] ${n}개 → ${out}${ffmpeg ? ' (WAV·OGG·MP3)' : ' (WAV, ffmpeg 없음)'}`);
