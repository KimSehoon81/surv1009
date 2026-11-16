import { expect, test } from '@playwright/test';

// 스모크(D44): 부팅 → 작전지도 → 전투 30초(자동 진행) → 결과 화면, 그 동안 콘솔 오류·페이지 오류 0
type Win = Window & { __game?: { scene: { getScenes(active: boolean): { sys: { settings: { key: string } } }[]; getScene(k: string): unknown } } };

test('켜지고, 싸우고, 끝난다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/?reset=1&seed=1&auto=stage1&speed=8&autoSec=30');
  const scenes = () => page.evaluate(() => ((window as Win).__game?.scene.getScenes(true) ?? []).map((s) => s.sys.settings.key));
  const seen = new Set<string>();
  const until = async (key: string, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (const k of await scenes()) seen.add(k);
      if (seen.has(key)) return;
      await page.waitForTimeout(100);
    }
    throw new Error(`${key} 장면에 닿지 못함 (본 장면: ${[...seen].join(', ')})`);
  };
  await until('Menu', 15_000);
  await until('Map', 10_000);
  await until('Battle', 15_000);
  // 결과: 전투가 진행됐고(처치 > 0) 결과 화면이 떴다
  await expect
    .poll(() => page.evaluate(() => Boolean((((window as Win).__game?.scene.getScene('Battle') ?? {}) as { result?: unknown }).result)), { timeout: 45_000 })
    .toBe(true);
  const kills = await page.evaluate(() => (((window as Win).__game?.scene.getScene('Battle') ?? {}) as { run: { kills: number } }).run.kills);
  expect(kills).toBeGreaterThan(0);
  expect(await page.locator('#fatal-error').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('전역 오류는 오류 화면과 콘솔 기록으로', async ({ page }) => {
  const logged: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') logged.push(m.text());
  });
  await page.goto('/?reset=1');
  await page.waitForFunction(() => Boolean((window as Win).__game));
  await page.evaluate(() => setTimeout(() => Promise.reject(new Error('qa-test-rejection')), 0));
  await expect(page.locator('#fatal-error')).toBeVisible();
  await expect(page.locator('#fatal-error pre')).toContainText('qa-test-rejection');
  expect(logged.some((l) => l.includes('qa-test-rejection'))).toBe(true);
});

// 모바일(2026-11-16): 세로로 든 터치 기기 → 가로로 돌린 화면 + 터치 조작판. 조이스틱으로 움직이고, 일시정지 → 뒤로가 된다
test.describe('휴대폰(세로로 듦)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('가로로 돌고, 손으로 조작한다', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto('/?reset=1&seed=1&stage=S1&battle=1');
    const mode = () => page.evaluate(() => document.getElementById('touch')?.dataset.mode);
    await expect.poll(mode, { timeout: 30_000 }).toBe('battle');
    expect(await page.evaluate(() => document.getElementById('game')?.classList.contains('rot'))).toBe(true);
    const px = () => page.evaluate(() => (((window as Win).__game?.scene.getScene('Battle') ?? {}) as { player: { x: number } }).player.x);
    const x0 = await px();
    // 게임 기준 왼쪽 아래를 누르고 오른쪽으로 끌기 = 돌린 화면에서는 창의 아래쪽으로
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, pts: { x: number; y: number }[]) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: pts });
    await touch('touchStart', [{ x: 390 - 280, y: 120 }]);
    await touch('touchMove', [{ x: 390 - 280, y: 200 }]);
    await page.waitForTimeout(800);
    await touch('touchEnd', []);
    expect(await px()).toBeGreaterThan(x0 + 20);
    const tap = async (sel: string) => {
      const b = await page.locator(sel).boundingBox();
      if (!b) throw new Error(`${sel} 없음`);
      await touch('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]);
      await touch('touchEnd', []);
    };
    await tap('.t-pause');
    await expect.poll(mode, { timeout: 3_000 }).toBe('menu');
    await tap('.t-back');
    await expect.poll(mode, { timeout: 3_000 }).toBe('battle');
    expect(await page.locator('#fatal-error').count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
