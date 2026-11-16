// 배너 그림 만들기: node tools/make-banner.mjs → public/banner/banner_<크기>.png (2배 해상도)
// 첫 화면 배경(public/assets/sprites/title_bg.png) + 걷는 병사 + 도트 글꼴 제목. Playwright(chromium)로 HTML을 찍음
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node-tools/node_modules/')('playwright'));
}
const url = (p) => pathToFileURL(join(root, 'public', p)).href;

// [가로, 세로, 배치] — 배치: wide = 한 줄(제목 왼쪽·버튼 오른쪽), box = 위아래
const SIZES = [
  [728, 90, 'wide'],
  [320, 100, 'wide'],
  [300, 250, 'box'],
  [600, 300, 'box'],
];
const soldiers = ['A03', 'A02', 'A01'];

const html = (w, h, kind) => {
  const u = kind === 'wide' ? h / 90 : Math.min(w / 300, h / 250);
  const narrow = kind === 'wide' && w < 500;
  const title = kind === 'wide' ? (narrow ? 27 : 34) * u : 36 * u;
  const sub = kind === 'wide' ? (narrow ? 0 : 12 * u) : 13 * u;
  const cta = kind === 'wide' ? (narrow ? 13 : 16) * u : 18 * u;
  const sprite = kind === 'wide' ? (narrow ? 0.72 : 1) * u : 1.5 * u;
  const men = (narrow ? soldiers.slice(1) : soldiers)
    .map((id, i) => `<div class="man" style="background-image:url('${url(`assets/chars/${id}_move_slow.png`)}'); margin-left:${i ? -52 * sprite : 0}px"></div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: G14; src: url('${url('fonts/Galmuri14.woff2')}'); }
    @font-face { font-family: G11; src: url('${url('fonts/Galmuri11.woff2')}'); }
    html, body { margin: 0; background: #120d0a; }
    #b { position: relative; width: ${w}px; height: ${h}px; overflow: hidden; font-family: G14, sans-serif; box-sizing: border-box; border: ${2 * u}px solid #1a1410;
      background: url('${url('assets/sprites/title_bg.png')}') ${kind === 'wide' ? 'center 46%' : 'center 40%'} / ${kind === 'wide' ? '100% auto' : 'auto 118%'} no-repeat; image-rendering: pixelated; }
    #b::before { content: ''; position: absolute; inset: 0; background: ${kind === 'wide' ? 'linear-gradient(90deg, rgba(18,10,8,.78) 0%, rgba(18,10,8,.5) 45%, rgba(18,10,8,.05) 75%)' : 'linear-gradient(180deg, rgba(18,10,8,.72) 0%, rgba(18,10,8,.25) 50%, rgba(18,10,8,.55) 100%)'}; }
    #b::after { content: ''; position: absolute; inset: 0; border: ${1 * u}px solid rgba(255, 210, 120, .55); }
    .txt { position: absolute; ${kind === 'wide' ? `left: ${12 * u}px; top: 50%; transform: translateY(-52%);` : `left: 0; right: 0; top: ${20 * u}px; text-align: center;`} }
    .tag { display: inline-block; font-family: G11; font-size: ${(kind === 'wide' ? 10 : 12) * u}px; color: #fff; background: #b02a1c; padding: ${1 * u}px ${6 * u}px; letter-spacing: ${2 * u}px; ${narrow ? 'display: none;' : ''} }
    .title { font-size: ${title}px; line-height: 1.15; white-space: nowrap; background: linear-gradient(180deg, #ffe98a 0%, #ffc23a 48%, #f07a1c 100%); -webkit-background-clip: text; color: transparent;
      filter: drop-shadow(${2 * u}px 0 0 #1a0c06) drop-shadow(-${2 * u}px 0 0 #1a0c06) drop-shadow(0 ${2 * u}px 0 #1a0c06) drop-shadow(0 -${2 * u}px 0 #1a0c06) drop-shadow(0 ${3 * u}px 0 #5a1408); }
    .sub { font-family: G11; font-size: ${sub}px; color: #ffe8c0; text-shadow: 0 ${1 * u}px 0 #000, 0 0 ${3 * u}px #000; margin-top: ${3 * u}px; white-space: nowrap; ${sub ? '' : 'display: none;'} }
    .cta { position: absolute; ${kind === 'wide' ? `right: ${12 * u}px; top: 50%; transform: translateY(-50%);` : `left: 50%; bottom: ${16 * u}px; transform: translateX(-50%);`}
      font-size: ${cta}px; color: #1a1006; background: linear-gradient(180deg, #ffe98a, #ffb02e); padding: ${6 * u}px ${12 * u}px; border: ${2 * u}px solid #1a0c06;
      box-shadow: 0 ${3 * u}px 0 #7a3a0c, 0 0 0 ${1 * u}px #ffe9a8 inset; white-space: nowrap; }
    .men { position: absolute; display: flex; ${kind === 'wide' ? `right: ${(narrow ? 86 : 150) * u}px; bottom: ${-8 * sprite}px;` : `left: 50%; transform: translateX(-50%); bottom: ${46 * u}px;`} }
    ${narrow ? `.txt { top: ${9 * u}px; transform: none; } .cta { top: auto; bottom: ${9 * u}px; transform: none; padding: ${4 * u}px ${10 * u}px; } .men { right: auto; left: ${14 * u}px; bottom: ${-14 * sprite}px; }` : ''}
    .man { width: ${100 * sprite}px; height: ${100 * sprite}px; background-size: ${400 * sprite}px ${400 * sprite}px; background-position: 0 0; image-rendering: pixelated; filter: drop-shadow(0 ${2 * u}px 0 rgba(0,0,0,.45)); }
  </style></head><body><div id="b">
    <div class="men">${men}</div>
    <div class="txt"><div class="tag">1950 · 한국전쟁</div><div class="title">압록강 서바이벌</div><div class="sub">${kind === 'wide' ? '낙동강에서 압록강까지 — 도트 서바이벌 + 전략카드' : '도트 서바이벌 + 전략카드 조합'}</div></div>
    <div class="cta">▶ 지금 플레이</div>
  </div></body></html>`;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const [w, h, kind] of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  // 로컬 그림·글꼴을 읽을 수 있게 file:// 문서로
  const tmp = join(root, 'public', 'banner', `_tmp_${w}x${h}.html`);
  const fs = await import('node:fs/promises');
  await fs.writeFile(tmp, html(w, h, kind));
  await page.goto(pathToFileURL(tmp).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.locator('#b').screenshot({ path: join(root, 'public', 'banner', `banner_${w}x${h}.png`) });
  await fs.unlink(tmp);
  console.log(`banner_${w}x${h}.png`);
}
await browser.close();
