import { defineConfig } from '@playwright/test';

// 자동 QA(D44): 빌드 결과를 vite preview로 띄워 스모크 테스트. npm run check에는 넣지 않음(무거움)
const PORT = 4317;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 960, height: 540 },
    trace: 'off',
    // 클라우드 세션은 미리 깔린 Chromium(/opt/pw-browsers), 그 밖에서는 Playwright 기본 브라우저
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: false, timeout: 60_000 },
});
