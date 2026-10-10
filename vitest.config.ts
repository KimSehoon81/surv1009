import { defineConfig } from 'vitest/config';

// 테스트는 Phaser 없이 순수 로직(core·clock·manifest 등)만 대상으로 한다
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
