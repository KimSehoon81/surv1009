import * as Phaser from 'phaser';
import available from '../assets/available.json';
import { manifest } from '../assets/manifest';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { Depth } from '../config/depth';
import { registerUnitAnims } from '../systems/anims';
import { SceneKey } from './keys';

/** public/assets에 시트가 있는 유닛 ID(없으면 A01 하나로 자리표시자 확인) */
export function galleryUnitIds(): string[] {
  const ids = new Set<string>();
  for (const path of available as string[]) {
    const m = /^(?:chars|enemies|npcs)\/([AEN]\d{2})_/.exec(path);
    if (m) ids.add(m[1] as string);
  }
  return ids.size ? [...ids].sort() : ['A01'];
}

const CELL = 110;
const LABEL_W = 60;

/**
 * 그래픽 검수용 화면(?gallery=1): 유닛마다 한 줄, 동작마다 한 칸에서 애니메이션을 반복 재생한다.
 * 빨간 선 = 발 기준선, 파란 선 = 가로 중심. 방향키·휠로 스크롤, G로 기준선 표시 전환.
 */
export class GalleryScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Gallery);
  }

  create(): void {
    const guides = this.add.graphics().setDepth(Depth.Debug);
    const ids = galleryUnitIds();
    let y = 40;
    for (const id of ids) {
      const anims = registerUnitAnims(this, id);
      // 실제 시트가 있는 동작만(대기 자세 대체 애니메이션은 제외)
      const actions = manifest.unitSheets(id).map((s) => s.action);
      // 대형(_L) 시트는 반으로 줄여 같은 칸에 맞춘다
      const large = manifest.unitSheets(id).some((s) => s.large);
      const scale = large ? 0.5 : 1;
      this.add.text(4, y + 40, id, { fontFamily: 'monospace', fontSize: '12px', color: '#ffe14d' });
      actions.forEach((action, i) => {
        const cx = LABEL_W + i * CELL + CELL / 2;
        const baseY = y + 92;
        this.add.text(cx, y + 96, action, { fontFamily: 'monospace', fontSize: '8px', color: '#c8c0b0' }).setOrigin(0.5, 0);
        const key = anims.keys[action] as string;
        this.add.sprite(cx, baseY, manifest.sheetKey(id, action), 0).setOrigin(manifest.anchor.x, manifest.anchor.y).setScale(scale).play({ key, repeat: -1, repeatDelay: 300 }); // 검수용: 한 번 재생 동작도 반복
        guides.lineStyle(1, 0xff3030, 0.7).lineBetween(cx - 45, baseY, cx + 45, baseY);
        guides.lineStyle(1, 0x3080ff, 0.5).lineBetween(cx, y, cx, baseY);
      });
      y += CELL;
    }
    this.add
      .text(LOGICAL_WIDTH - 4, 4, `유닛 ${ids.length} · 방향키/휠 스크롤 · G 기준선`, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff', backgroundColor: '#000000a0' })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(Depth.Ui);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#3a3a3a');
    const maxY = Math.max(0, y - LOGICAL_HEIGHT + 20);
    const scroll = (dy: number) => cam.setScroll(cam.scrollX, Phaser.Math.Clamp(cam.scrollY + dy, 0, maxY));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => scroll(dy * 0.5));
    const kb = this.input.keyboard;
    kb?.on('keydown-DOWN', () => scroll(CELL));
    kb?.on('keydown-UP', () => scroll(-CELL));
    kb?.on('keydown-G', () => guides.setVisible(!guides.visible));
  }
}
