import type * as Phaser from 'phaser';
import skillsData from '../data/skills.json';
import { manifest } from '../assets/manifest';
import type { SkillSlots } from '../core/skills';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../config/display';
import { PIXEL_FONT } from './pixelFont';

const BOX = 34;
const GAP = 6;
const RIGHT = 16;
const BOTTOM = 12;

/** 고급 스킬 슬롯 4칸(Q·E·R·F)과 TP 게이지(화면 오른쪽 아래, PRD §6.1·§11) */
export class SkillHud {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly icons: (Phaser.GameObjects.Image | null)[] = [];
  private readonly costs: Phaser.GameObjects.BitmapText[] = [];
  private readonly tpText: Phaser.GameObjects.BitmapText;
  private readonly x0 = LOGICAL_WIDTH - RIGHT - 4 * BOX - 3 * GAP;
  private readonly y0 = LOGICAL_HEIGHT - BOTTOM - BOX;

  constructor(
    scene: Phaser.Scene,
    private readonly skills: SkillSlots,
    private readonly now: () => number,
  ) {
    this.gfx = scene.add.graphics();
    skills.slots.forEach((slot, i) => {
      const x = this.x0 + i * (BOX + GAP);
      const def = slot.skillId ? skillsData.skills[slot.skillId as keyof typeof skillsData.skills] : undefined;
      this.icons.push(def ? scene.add.image(x + BOX / 2, this.y0 + BOX / 2, manifest.image('skills', def.icon, 32, 32).key) : null);
      scene.add.bitmapText(x + 1, this.y0 - 9, PIXEL_FONT, slot.key, 7).setLetterSpacing(-1);
      this.costs.push(
        scene.add
          .bitmapText(x + BOX - 1, this.y0 + BOX - 1, PIXEL_FONT, def ? String(def.tpCost) : '', 7)
          .setOrigin(1, 1)
          .setLetterSpacing(-1),
      );
    });
    this.tpText = scene.add.bitmapText(this.x0, this.y0 - 24, PIXEL_FONT, 'TP', 7).setLetterSpacing(-1);
  }

  update(): void {
    const now = this.now();
    const s = this.skills;
    const g = this.gfx.clear();
    // TP 게이지
    const w = 4 * BOX + 3 * GAP - 34;
    const bx = this.x0 + 34;
    const by = this.y0 - 22;
    this.tpText.setText(`TP ${Math.floor(s.tp)}`);
    g.fillStyle(0x1a1410, 0.9).fillRect(bx - 1, by - 1, w + 2, 7);
    g.fillStyle(0x2a2a3a, 1).fillRect(bx, by, w, 5);
    g.fillStyle(0x7fd8ff, 1).fillRect(bx, by, Math.round((w * s.tp) / s.tpMax), 5);

    s.slots.forEach((slot, i) => {
      const x = this.x0 + i * (BOX + GAP);
      const y = this.y0;
      const icon = this.icons[i];
      const reason = s.check(i, now);
      g.fillStyle(0x1a1610, 0.9).fillRect(x, y, BOX, BOX);
      if (slot.locked || !icon) {
        icon?.setVisible(false);
        // 자물쇠(코드로 그림)
        g.fillStyle(0x5a5040, 1).fillRect(x + 12, y + 16, 10, 8);
        g.lineStyle(2, 0x5a5040, 1).strokeRect(x + 14, y + 11, 6, 6);
        this.costs[i]?.setVisible(false);
      } else {
        icon.setVisible(true).setTint(reason === null ? 0xffffff : 0x8a8a8a);
        // 쿨다운: 위에서부터 어둡게 덮고 줄어듦
        const cd = s.cooldownLeft(i, now);
        if (cd > 0) g.fillStyle(0x000000, 0.6).fillRect(x, y, BOX, Math.round(BOX * cd));
        this.costs[i]?.setVisible(true).setTint(reason === 'tp' ? 0xff6050 : 0xffffff);
      }
      g.lineStyle(1, reason === null ? 0x7fd8ff : 0x6a5a40, 1).strokeRect(x + 0.5, y + 0.5, BOX - 1, BOX - 1);
    });
  }
}
