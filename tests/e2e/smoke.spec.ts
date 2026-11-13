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
