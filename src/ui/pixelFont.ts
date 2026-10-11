import * as Phaser from 'phaser';

// 데미지 숫자·콤보용 3×5 도트 글꼴. 1px 외곽선을 포함해 칸 하나가 5×7.
// 흰 글자에 어두운 외곽선이라 BitmapText tint로 색만 바꿔 쓴다(외곽선은 tint 곱해도 어두움 유지).

export const PIXEL_FONT = 'pixel35';

const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001010010',
  '8': '111101111101111',
  '9': '111101111001111',
  K: '101101110101101',
  I: '111010010010111',
  L: '100100100100111',
  C: '111100100100111',
  O: '010101101101010',
  M: '101111111101101',
  B: '110101110101110',
  X: '101101010101101',
  V: '101101101101010',
  '+': '000010111010000',
  '-': '000000111000000',
  '!': '010010010000010',
  ' ': '000000000000000',
};

const CELL_W = 5;
const CELL_H = 7;
const OUTLINE = '#1a1410';

/** 글꼴 텍스처와 BitmapFont를 한 번만 등록한다(텍스처·캐시는 게임 전역) */
export function ensurePixelFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(PIXEL_FONT)) return;
  const chars = Object.keys(GLYPHS);
  const tex = scene.textures.createCanvas(PIXEL_FONT, CELL_W * chars.length, CELL_H);
  if (!tex) throw new Error('pixelFont: 텍스처 생성 실패');
  const ctx = tex.getContext();
  chars.forEach((ch, i) => {
    const bits = GLYPHS[ch] ?? '';
    const ox = i * CELL_W + 1;
    const oy = 1;
    const on = (x: number, y: number) => x >= 0 && x < 3 && y >= 0 && y < 5 && bits[y * 3 + x] === '1';
    // 외곽선: 글자 픽셀의 상하좌우 이웃(대각선까지 칠하면 글자 전체가 검은 상자처럼 보인다)
    ctx.fillStyle = OUTLINE;
    for (let y = -1; y <= 5; y++) {
      for (let x = -1; x <= 3; x++) {
        if (on(x, y)) continue;
        const near = on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1);
        if (near) ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
    ctx.fillStyle = '#ffffff';
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (on(x, y)) ctx.fillRect(ox + x, oy + y, 1, 1);
  });
  tex.refresh();
  const config = { image: PIXEL_FONT, width: CELL_W, height: CELL_H, chars: chars.join(''), charsPerRow: chars.length };
  scene.cache.bitmapFont.add(PIXEL_FONT, Phaser.GameObjects.RetroFont.Parse(scene, config as Phaser.Types.GameObjects.BitmapText.RetroFontConfig));
}
