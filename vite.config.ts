import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로: GitHub Pages·itch.io 하위 경로 배포 대비(D45)
  base: './',
  build: {
    target: 'es2022',
    // 빌드 산출물(js)과 public/assets(사용자 그래픽)가 같은 폴더에 섞이지 않게 분리
    assetsDir: 'app',
    // Phaser 본체(약 1.2MB)는 별도 청크로 분리해 게임 코드 변경 시 캐시를 살린다
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
  server: { host: true },
});
